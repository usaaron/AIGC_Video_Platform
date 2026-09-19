"""Character names shared by author input, planning, screenplay and memory."""

from typing import Annotated

from pydantic import StringConstraints


# A canonical name can be a single Chinese character (for example 梅 or 乔).
# Reject empty identities without making the model rename a character merely
# to satisfy a Latin-letter-style minimum length.
CharacterName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]
