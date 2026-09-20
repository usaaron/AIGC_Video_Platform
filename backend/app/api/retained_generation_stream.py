"""Keep one accepted, bounded generation inside its original authorization.

Disconnecting a viewer does not undo an accepted durable generation. The ASGI
request stays alive until its worker finishes; storage identity is never copied
into a new scope and is still revoked when this response exits.
"""
from __future__ import annotations

import time
from threading import Event

import anyio
from fastapi.responses import StreamingResponse


class RetainedGenerationStreamingResponse(StreamingResponse):
    def __init__(self, *args, finished: Event, cancelled: Event, started: Event,
                 detached: Event, deadline_seconds: float, on_timeout=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.finished, self.cancelled, self.started = finished, cancelled, started
        self.detached = detached
        self.deadline_seconds = deadline_seconds
        self.on_timeout = on_timeout

    async def __call__(self, scope, receive, send):
        expires_at = time.monotonic() + self.deadline_seconds
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.detached.set()
            # Starlette cancels the streaming task group on disconnect. Shield
            # completion in this request so accepted work can commit its result
            # or failure checkpoint before request middleware revokes storage.
            with anyio.CancelScope(shield=True):
                while self.started.is_set() and not self.finished.is_set():
                    if time.monotonic() >= expires_at:
                        self.cancelled.set()
                        with anyio.move_on_after(1):
                            while not self.finished.is_set():
                                await anyio.sleep(0.025)
                        if self.on_timeout is not None:
                            await anyio.to_thread.run_sync(self.on_timeout)
                        break
                    await anyio.sleep(0.025)
            self.cancelled.set()
