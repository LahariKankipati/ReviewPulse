"""Application package initialization.

Import models so SQLAlchemy metadata is fully registered for migrations and tests.
"""

from app import models as models

__all__ = ["models"]
