import pytest

from app.protocol import (
    DebugLine,
    EventLine,
    HeartbeatLine,
    HelloLine,
    Rejected,
    parse_line,
)

VALID = [
    (b"EVT,can,0.94,RECYCLABLE,412\n", EventLine("can", 0.94, "RECYCLABLE", 412)),
    (b"EVT,glass_bottle,0.94,RECYCLABLE,412\n", EventLine("glass_bottle", 0.94, "RECYCLABLE", 412)),
    (b"EVT,pen,0.71,TRASH,398\n", EventLine("pen", 0.71, "TRASH", 398)),
    (b"EVT,phone_case,0.99,TRASH,0\n", EventLine("phone_case", 0.99, "TRASH", 0)),
    (b"EVT,uncertain,0.41,NONE,408\n", EventLine("uncertain", 0.41, "NONE", 408)),
    (b"EVT,background,0.88,NONE,401\n", EventLine("background", 0.88, "NONE", 401)),
    (b"EVT,can,1.00,RECYCLABLE,999999\n", EventLine("can", 1.0, "RECYCLABLE", 999999)),
    (b"EVT,pen,0.00,TRASH,5\n", EventLine("pen", 0.0, "TRASH", 5)),
    (b"EVT,can,0.94,RECYCLABLE,412\r\n", EventLine("can", 0.94, "RECYCLABLE", 412)),
    (b"  EVT,can,0.94,RECYCLABLE,412 \n", EventLine("can", 0.94, "RECYCLABLE", 412)),
    ("EVT,can,0.94,RECYCLABLE,412", EventLine("can", 0.94, "RECYCLABLE", 412)),
    (b"HELLO,1.2.0\n", HelloLine("1.2.0")),
    (b"HELLO,ecosort-0.3+rc1\r\n", HelloLine("ecosort-0.3+rc1")),
    (b"HB,0\n", HeartbeatLine(0)),
    (b"HB,5012\n", HeartbeatLine(5012)),
    (b"HB,4294967295\r\n", HeartbeatLine(4294967295)),
    (b"DBG,model loaded\n", DebugLine("model loaded")),
    (b"DBG,\n", DebugLine("")),
    (b"DBG,a,b,c 1 2 3\r\n", DebugLine("a,b,c 1 2 3")),
]

INVALID = [
    (b"EVT,can,0.94,RECYCLABLE\n", "too few fields"),
    (b"EVT,can,0.94,RECYCLABLE,412,9\n", "too many fields"),
    (b"EVT,can,0.9,RECYCLABLE,412\n", "confidence with one decimal"),
    (b"EVT,can,0.944,RECYCLABLE,412\n", "confidence with three decimals"),
    (b"EVT,can,1.01,RECYCLABLE,412\n", "confidence above 1"),
    (b"EVT,can,-0.50,RECYCLABLE,412\n", "negative confidence"),
    (b"EVT,can,abc,RECYCLABLE,412\n", "non-numeric confidence"),
    (b"EVT,bottle,0.94,RECYCLABLE,412\n", "unknown label"),
    (b"EVT,Can,0.94,RECYCLABLE,412\n", "label case"),
    (b"EVT,can,0.94,recyclable,412\n", "bin case"),
    (b"EVT,can,0.94,GLASS,412\n", "unknown bin"),
    (b"EVT,can,0.94,RECYCLABLE,-5\n", "negative latency"),
    (b"EVT,can,0.94,RECYCLABLE,4.5\n", "fractional latency"),
    (b"EVT,can,0.94,RECYCLABLE,0412\n", "leading zero latency"),
    (b"EVT,can,0.94,RECYCLABLE,1000000\n", "latency over six digits"),
    (b"EVT, can,0.94,RECYCLABLE,412\n", "space inside a field"),
    (b"evt,can,0.94,RECYCLABLE,412\n", "lowercase tag"),
    (b"EVT,can,0.94,RECYCLABLE,412;\n", "trailing junk"),
    (b"EVT,can,0.94,RECYCLABLE,\xd9\xa4\n", "non-ASCII digits"),
    (b"HELLO\n", "HELLO without version"),
    (b"HELLO,\n", "HELLO with empty version"),
    (b"HELLO,bad version\n", "HELLO with a space"),
    (b"HB\n", "HB without uptime"),
    (b"HB,-1\n", "negative uptime"),
    (b"HB,12ms\n", "uptime with units"),
    (b"HB,12345678901\n", "uptime over ten digits"),
    (b"DBG\n", "DBG without comma"),
    (b"DBG,caf\xc3\xa9\n", "non-ASCII debug text"),
    (b"DBG,bell\x07\n", "control character in debug text"),
    (b"hello world\n", "plain text"),
    (b"\x00\x01\x02\xff\xfe\n", "garbage bytes"),
    (b"\n", "empty line"),
    (b"   \r\n", "whitespace only"),
    (b"EVT,can,0.94,RECYCLABLE,412," + b"9" * 60 + b"\n", "oversize line"),
    (b"DBG," + b"x" * 61 + b"\n", "oversize debug line"),
    ("EVT,can,0.94,RECYCLABLE,412é", "non-ASCII str"),
]


@pytest.mark.parametrize(("raw", "expected"), VALID, ids=[str(i) for i in range(len(VALID))])
def test_valid_lines(raw: bytes | str, expected: object) -> None:
    assert parse_line(raw) == expected


@pytest.mark.parametrize(("raw", "why"), INVALID, ids=[why for _, why in INVALID])
def test_invalid_lines_are_rejected(raw: bytes | str, why: str) -> None:
    result = parse_line(raw)
    assert isinstance(result, Rejected), f"{why}: got {result!r}"
    assert result.reason


def test_line_at_exactly_64_bytes_is_accepted_and_65_is_not() -> None:
    at_limit = b"DBG," + b"x" * 60
    assert len(at_limit) == 64
    assert parse_line(at_limit) == DebugLine("x" * 60)
    assert isinstance(parse_line(at_limit + b"x"), Rejected)


def test_there_are_enough_cases() -> None:
    assert len(VALID) >= 10
    assert len(INVALID) >= 15
