"""Scenario interface: everything the generic agent needs to know about one use case."""
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import asdict, dataclass
from typing import Literal

CATEGORIES = ("attack_obvious", "attack_subtle", "attack_disguised", "benign")


@dataclass(frozen=True)
class SourceKind:
    kind: str
    label: str
    trusted: bool


@dataclass(frozen=True)
class Preset:
    id: str
    kind: str
    category: Literal["attack_obvious", "attack_subtle", "attack_disguised", "benign"]
    label: str
    text: str


@dataclass(frozen=True)
class SeedMemory:
    suffix: str
    key: str
    text: str


@dataclass(frozen=True)
class ToolResult:
    params: dict[str, str]
    summary: str
    reply_hint: str


@dataclass(frozen=True)
class Verdict:
    result: Literal["hijacked", "ok"]
    reason: str


class Scenario(ABC):
    id: str
    name: str
    tagline: str
    user_role: str
    agent_role: str
    available: bool
    source_kinds: tuple[SourceKind, ...] = ()
    presets: tuple[Preset, ...] = ()
    chat_suggestions: tuple[str, ...] = ()
    seed: tuple[SeedMemory, ...] = ()
    attack_samples: tuple[str, ...] = ()
    system_prompt: str = ""

    @abstractmethod
    def tools(self) -> list[Callable]:
        """Plain functions (type hints + docstrings) that can be bound to the LLM."""

    @abstractmethod
    def execute(self, tool_name: str, args: dict) -> ToolResult:
        """Run a tool in the sandbox. Must never touch anything real."""

    @abstractmethod
    def verdict(self, tool_name: str, params: dict[str, str],
                user_memories: dict[str, str]) -> Verdict:
        """Judge an executed action against what the user themselves asked for."""

    def manifest(self) -> dict:
        return {
            "id": self.id, "name": self.name, "tagline": self.tagline,
            "user_role": self.user_role, "agent_role": self.agent_role,
            "available": self.available,
            "source_kinds": [asdict(k) for k in self.source_kinds],
            "presets": [asdict(p) for p in self.presets],
            "chat_suggestions": list(self.chat_suggestions),
        }


class UnavailableScenario(Scenario):
    """A scenario announced on the landing page but not built yet: no tools."""
    available = False

    def tools(self) -> list[Callable]:
        return []

    def execute(self, tool_name: str, args: dict) -> ToolResult:
        raise NotImplementedError(f"{self.id} is not available yet")

    def verdict(self, tool_name, params, user_memories) -> Verdict:
        raise NotImplementedError(f"{self.id} is not available yet")


__all__ = ["CATEGORIES", "Preset", "Scenario", "SeedMemory", "SourceKind", "ToolResult",
           "UnavailableScenario", "Verdict"]
