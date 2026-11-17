"""Scenario registry."""
from scenarios.base import Scenario
from scenarios.coding_assistant import CodingAssistant
from scenarios.email_assistant import EmailAssistant
from scenarios.shopping import Shopping

_REGISTRY: dict[str, Scenario] = {s.id: s for s in (Shopping(), EmailAssistant(), CodingAssistant())}


def get(scenario_id: str) -> Scenario:
    return _REGISTRY[scenario_id]  # KeyError if unknown


def all() -> list[Scenario]:
    return list(_REGISTRY.values())
