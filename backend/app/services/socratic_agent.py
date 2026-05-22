"""Compatibility shim — socratic agent now lives in services/socratic/."""
from .socratic import SocraticAgent, AgentResponse, SessionState, SessionStore, socratic_agent  # noqa: F401
