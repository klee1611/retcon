"""Lazy, once-per-process Mongo handle (serverless instances are short-lived)."""
import os
from functools import lru_cache

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.database import Database


@lru_cache(maxsize=1)
def get_database() -> Database:
    load_dotenv()
    client = MongoClient(
        os.environ["MONGODB_URI"], tz_aware=True,
        serverSelectionTimeoutMS=int(os.environ.get("MONGO_TIMEOUT_MS", "3000")))
    return client[os.environ.get("RETCON_DB", "retcon")]
