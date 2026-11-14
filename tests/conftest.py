import pytest

from retcon import get_db, make_store, setup

TEST_DB = "retcon_test"


@pytest.fixture(scope="session")
def db():
    d = get_db(TEST_DB)
    setup(d, reset=True)
    make_store(d)  # builds the memories vector index once
    yield d
    # dropDatabase is not permitted for this user: drop collections one by one
    for name in d.list_collection_names():
        d.drop_collection(name)


@pytest.fixture
def store(db):
    for name in ("memories", "quarantine", "memory_history", "sources"):
        db[name].delete_many({})
    return make_store(db, enabled=True, user_id="user_42")
