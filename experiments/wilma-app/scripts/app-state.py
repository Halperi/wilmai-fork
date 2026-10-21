"""The desktop app's stored state as JSON, for looking into what the app shows (no Wilma, no OpenAI).

The app keeps its state in WebKit's IndexedDB (~/Library/WebKit/ai.wilm.home/.../IndexedDB.sqlite3). This
reads a copy of that file (WebKit's SerializedScriptValue: objects, arrays, strings with their pool, numbers,
dates as {"$date": ms}) and writes every record but the Wilma session (cookies stay out):

    python3 scripts/app-state.py /path/to/copy/IndexedDB.sqlite3 state.json

Copy the database (with its -wal) first; don't read the live file while the app runs. state.json holds the
family's data: keep it out of the repo (evals/results/ or a temp folder).
"""

import sqlite3, struct, json, sys, re

TERMINATOR, POOL = 0xFFFFFFFF, 0xFFFFFFFE

class Reader:
    def __init__(self, b):
        self.b, self.i, self.pool, self.objects = b, 0, [], []
    def u8(self):
        v = self.b[self.i]; self.i += 1; return v
    def u32(self):
        v = struct.unpack_from("<I", self.b, self.i)[0]; self.i += 4; return v
    def peek32(self):
        return struct.unpack_from("<I", self.b, self.i)[0]
    def string(self, first=None):
        n = self.u32() if first is None else first
        if n == POOL:
            size = len(self.pool)
            idx = self.u8() if size <= 0xFF else (struct.unpack_from("<H", self.b, self.i)[0] if size <= 0xFFFF else self.u32())
            if 0xFF < size <= 0xFFFF: self.i += 2
            return self.pool[idx]
        if n == TERMINATOR: return None
        eight, L = bool(n & 0x80000000), n & 0x7FFFFFFF
        if eight:
            s = self.b[self.i:self.i + L].decode("latin1"); self.i += L
        else:
            s = self.b[self.i:self.i + 2 * L].decode("utf-16-le"); self.i += 2 * L
        self.pool.append(s)
        return s
    def value(self):
        tag = self.u8()
        if tag == 1:   # ArrayTag
            length = self.u32(); arr = [None] * length; self.objects.append(arr)
            while True:
                idx = self.u32()
                if idx == TERMINATOR: break
                arr[idx] = self.value()
            while True:     # non-index properties
                name = self.string()
                if name is None: break
                self.value()
            return arr
        if tag == 2:   # ObjectTag
            obj = {}; self.objects.append(obj)
            while True:
                name = self.string()
                if name is None: break
                obj[name] = self.value()
            return obj
        if tag in (3, 4): return None
        if tag == 5: v = struct.unpack_from("<i", self.b, self.i)[0]; self.i += 4; return v
        if tag == 6: return 0
        if tag == 7: return 1
        if tag == 8: return False
        if tag == 9: return True
        if tag == 10: v = struct.unpack_from("<d", self.b, self.i)[0]; self.i += 8; return v
        if tag == 11: v = struct.unpack_from("<d", self.b, self.i)[0]; self.i += 8; return {"$date": v}
        if tag == 16: return self.string()
        if tag == 17: return ""
        if tag == 19:  # ObjectReferenceTag
            size = len(self.objects)
            idx = self.u8() if size <= 0xFF else (struct.unpack_from("<H", self.b, self.i)[0] if size <= 0xFFFF else self.u32())
            if 0xFF < size <= 0xFFFF: self.i += 2
            return self.objects[idx]
        if tag == 30 or tag == 29:  # Map / Set
            out = []; self.objects.append(out)
            while self.peek32() != TERMINATOR or self.b[self.i] != 0xFF:
                if tag == 30: out.append([self.value(), self.value()])
                else: out.append(self.value())
                if self.b[self.i:self.i + 4] == b"\xff\xff\xff\xff": break
            self.i += 4
            while True:
                name = self.string()
                if name is None: break
                self.value()
            return out
        raise ValueError(f"tag {tag} at {self.i - 1}")

def read(blob):
    r = Reader(blob)
    r.version = r.u32()
    return r.value()

if __name__ == "__main__":
    db = sqlite3.connect(sys.argv[1])
    out = {}
    for k, v in db.execute("select key, value from Records"):
        kb = k.encode() if isinstance(k, str) else bytes(k)
        name = re.sub(rb"[^ -~]", b"", kb).decode().lstrip("`")
        if name == "session":  # the Wilma session's cookies: never written out
            continue
        try:
            out[name] = read(bytes(v))
        except Exception as e:
            out[name] = {"$error": str(e)}
    json.dump(out, open(sys.argv[2], "w"), ensure_ascii=False, default=str)
    print({k: (type(v).__name__ if not (isinstance(v, dict) and "$error" in v) else v["$error"]) for k, v in out.items()})
