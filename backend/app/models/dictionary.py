"""Dictionary cache model for MOE dictionary API results."""
from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class DictionaryCache(Base):
    """Caches MOE dictionary API results to avoid repeated external calls.

    Each row stores the parsed definitions for a single Chinese character.
    The cache is keyed by (character, source) to allow future expansion
    with alternative dictionary sources.
    """

    __tablename__ = "dictionary_cache"
    __table_args__ = (
        UniqueConstraint("character", "source", name="uq_dictionary_cache_char_source"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # The Chinese character being cached (single hanzi)
    character: Mapped[str] = mapped_column(String(4), nullable=False, index=True)

    # Dictionary source identifier (default: "moedict")
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="moedict")

    # Zhuyin phonetic notation (e.g. "ㄕㄢ")
    zhuyin: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Stroke count
    stroke_count: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Full parsed definitions stored as JSON array
    # Each element: {"type": "名", "definition": "...", "example": "..."}
    definitions: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Raw API response stored for debugging / re-parsing
    raw_response: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Timestamp of last fetch from external API
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # NULL means the character was not found in the dictionary
    not_found: Mapped[bool] = mapped_column(Integer, nullable=False, default=False)
