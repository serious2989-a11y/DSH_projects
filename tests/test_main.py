import io
from contextlib import redirect_stdout

from main import print_hi


def test_print_hi() -> None:
    buffer = io.StringIO()
    with redirect_stdout(buffer):
        print_hi("PyCharm")
    assert buffer.getvalue().strip() == "Hi, PyCharm"
