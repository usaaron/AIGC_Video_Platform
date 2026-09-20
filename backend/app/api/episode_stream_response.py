"""ASGI-owned cleanup runs before request storage identity is revoked."""
import anyio
from fastapi.responses import StreamingResponse


class EpisodeStreamingResponse(StreamingResponse):
    def __init__(self, *args, lifecycle, **kwargs):
        super().__init__(*args, **kwargs)
        self.lifecycle = lifecycle

    async def __call__(self, scope, receive, send):
        async def observe_receive():
            message = await receive()
            if message["type"] == "http.disconnect":
                # Wake the synchronous queue reader before Starlette waits for
                # its cancelled threadpool iteration to return.
                self.lifecycle.cancel.set()
                self.lifecycle.wake()
            return message
        try:
            await super().__call__(scope, observe_receive, send)
        finally:
            self.lifecycle.cancel.set()
            # Starlette cancels its task group on disconnect; cleanup must still
            # finish in this request's existing authorization, without cloning it.
            with anyio.CancelScope(shield=True):
                await anyio.to_thread.run_sync(self.lifecycle.close)
