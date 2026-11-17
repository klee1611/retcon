from scenarios.base import SourceKind, UnavailableScenario


class EmailAssistant(UnavailableScenario):
    id = "email"
    name = "Email assistant"
    tagline = ("An assistant that reads your inbox: one planted email can make it "
               "send your mail to a stranger.")
    user_role = "Mailbox owner"
    agent_role = "Email assistant"
    source_kinds = (SourceKind("email", "Incoming email", False),)
