# data/

| File | Read by | Written by |
| --- | --- | --- |
| `metrics.json` | `/project` | by hand: the measured results shown there |
| `testing.json` | `/testing`, and the numbers on `/` | `python scripts/record_tests.py` |
| `sample_session.rec` | `SOURCE=replay` | `scripts/record.py` |

`testing.json` is written by the script, except `media`, which is yours: the recorder never
overwrites it. List the photographs and videos of the real rig there, with the files in
`frontend/public/testing/`:

```json
"media": [
  { "file": "rig.jpg", "kind": "image", "caption": "The rig on the bench" },
  { "file": "counting.mp4", "kind": "video", "caption": "Counting an item" }
]
```

A file name must be plain (letters, digits, dot, dash, underscore): no folders, no addresses.
