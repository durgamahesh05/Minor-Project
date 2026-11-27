"""Per-request output budgets; never mutate shared model settings."""
import re
from dataclasses import dataclass
from typing import Literal

ResponseLevel = Literal["auto", "simple", "detailed", "deep"]
LIMITS = {"simple": 500, "detailed": 2000, "deep": 5000}
# UI languages (frontend i18n codes) that answers can be written in.
LANGUAGE_NAMES = {"en": "English", "hi": "Hindi", "te": "Telugu", "es": "Spanish", "fr": "French"}


def language_name(language: str | None) -> str | None:
    """Return the language to answer in, or None to follow the user's own language."""
    code = (language or "auto").strip().lower().replace("_", "-").split("-")[0]
    return LANGUAGE_NAMES.get(code)


def language_instruction(language: str | None) -> str:
    name = language_name(language)
    if name:
        return (f"Write the entire response in {name}, even when the question or the source material is in another language. "
                "Keep citations, file names, code, formulas and proper nouns unchanged.")
    return "Reply in the same language the user writes in."


@dataclass(frozen=True)
class ResponsePolicy:
    max_tokens: int
    instruction: str


def response_policy(message: str, selected: ResponseLevel = "simple", language: str | None = None) -> ResponsePolicy:
    text = message.lower()
    explicit = None
    # Later explicit preferences win when a user revises their instruction.
    patterns = {
        "simple": r"\b(simply|simple explanation|briefly|brief|concise|short answer|in simple terms)\b",
        "detailed": r"\b(in detail|detailed explanation|explain thoroughly)\b",
        "deep": r"\b(full tutorial|in depth|in-depth|comprehensive tutorial|complete tutorial)\b",
    }
    matches = [(match.start(), level) for level, pattern in patterns.items() for match in re.finditer(pattern, text)]
    if matches:
        explicit = max(matches)[1]
    level = explicit or selected
    if level == "auto":
        if re.search(r"\b(derive|proof|architecture|trade-offs|tradeoffs|comprehensive)\b", text):
            budget = 2000
        elif re.search(r"\b(compare|difference|why|how|step by step|explain)\b", text):
            budget = 1000
        else:
            budget = 500
    else:
        budget = LIMITS.get(level, 500)
    instruction = "Follow the user's explicit instructions and requested format before the selected detail level. Stop when complete; never pad the answer to consume the budget."
    length = list(re.finditer(r"\b(?:in|within|about|approximately|exactly|under|at most|no more than)\s+(\d+)\s+(lines?|words?)\b", text))
    if length:
        count = int(length[-1].group(1))
        unit = length[-1].group(2)
        if count > 0:
            if unit.startswith("word"):
                budget = min(5000, max(32, count * 2))
                instruction += f" Aim for {count} words, respecting any exact or maximum wording in the request."
            else:
                budget = min(5000, max(128, count * 100))
                instruction += f" Use {count} newline-separated lines (not visual wrapping); no extra introduction or conclusion. Respect any maximum qualifier."
    instruction += f" Output budget: at most {budget} tokens. Be concise within this cap; do not treat it as a target."
    instruction += " " + language_instruction(language)
    return ResponsePolicy(budget, instruction)
