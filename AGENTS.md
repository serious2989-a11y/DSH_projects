# Project instructions

## Stack

- Python 3.12, virtualenv in `.venv`.
- Run the app: `.venv\Scripts\python.exe main.py`
- Run tests: `.venv\Scripts\python.exe -m pytest`

## Rules

- Keep changes small and focused; one task per change.
- Add or update tests under `tests/` for new behavior.
- Use type hints in new Python code.
- Do not commit `.venv`, `.idea`, or local tooling directories.
- Do not paste secrets, API keys, or credential files into the chat.
- Prefer `pytest` for tests; keep test files small.

## Token economy

- Show diffs or the changed fragment, not whole files.
- Ask before large refactors or dependency changes.
- Prefer one session per task; start a new session for a new task.
