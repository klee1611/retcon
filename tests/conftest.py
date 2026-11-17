import os

import pytest

from retcon import get_db, make_store, setup
from retcon.db import COLLECTIONS

TEST_DB = os.environ.get("RETCON_TEST_DB", "retcon_test")
SID = "s_alice"
OTHER = "s_bob"
DATA = [c for c in COLLECTIONS if c != "attack_patterns"]


@pytest.fixture(scope="session")
def db():
    d = get_db(TEST_DB)
    setup(d, reset=True)
    yield d
    # dropDatabase is not permitted for this user: drop collections one by one
    for name in d.list_collection_names():
        d.drop_collection(name)


@pytest.fixture
def store(db):
    for name in DATA:
        db[name].delete_many({})
    return make_store(db, session_id=SID, enabled=True)


@pytest.fixture
def sdb(db):
    """The test database with every per-session collection cleared (sessions, actions...)."""
    for name in DATA:
        db[name].delete_many({})
    return db
