#!/usr/bin/env python3
"""Gera a ISO de instalação automática (rótulo CIDATA) sem precisar de xorriso/genisoimage.

Uso:  python3 gerar-seed-iso.py SAIDA.iso user-data meta-data [outros arquivos...]

Formato: ISO 9660 com extensão Joliet (nomes longos, ex.: "user-data"), um diretório só.
É o que o Ubuntu procura para a instalação automática (cloud-init NoCloud).
"""
import os
import struct
import sys
import time

SECTOR = 2048
LABEL = "CIDATA"


def both16(n): return struct.pack("<H", n) + struct.pack(">H", n)
def both32(n): return struct.pack("<I", n) + struct.pack(">I", n)
def pad(b, size, fill=b" "): return (b + fill * size)[:size]
def sectors(n): return (n + SECTOR - 1) // SECTOR


def dir_time(t):
    g = time.gmtime(t)
    return bytes([g.tm_year - 1900, g.tm_mon, g.tm_mday, g.tm_hour, g.tm_min, g.tm_sec, 0])


def vol_time(t):
    return time.strftime("%Y%m%d%H%M%S", time.gmtime(t)).encode() + b"00" + b"\x00"


def dir_record(name_bytes, extent, size, is_dir, t):
    name_len = len(name_bytes)
    rec_len = 33 + name_len + (1 if name_len % 2 == 0 else 0)
    r = bytes([rec_len, 0]) + both32(extent) + both32(size) + dir_time(t)
    r += bytes([2 if is_dir else 0, 0, 0]) + both16(1) + bytes([name_len]) + name_bytes
    if name_len % 2 == 0:
        r += b"\x00"
    return r


def iso_name(name, used):
    """Nome curto ISO 9660 nível 1 (8.3, maiúsculas)."""
    base, _, ext = name.upper().rpartition(".") if "." in name else (name.upper(), "", "")
    keep = lambda s: "".join(c if c.isalnum() else "_" for c in s)
    base, ext = keep(base)[:8] or "F", keep(ext)[:3]
    cand, i = base, 1
    while f"{cand}.{ext}" in used:
        cand = f"{base[:6]}{i:02d}"[:8]
        i += 1
    used.add(f"{cand}.{ext}")
    return f"{cand}.{ext};1".encode("ascii")


def build(out, files):
    now = time.time()
    names = [os.path.basename(f) for f in files]
    datas = [open(f, "rb").read() for f in files]

    # layout dos setores
    # 16 PVD, 17 SVD (Joliet), 18 terminador, 19-22 tabelas de caminho, 23 raiz, 24 raiz Joliet, 25+ arquivos
    PT_L, PT_M, JPT_L, JPT_M = 19, 20, 21, 22
    ROOT, JROOT = 23, 24
    extents, nxt = [], 25
    for d in datas:
        extents.append(nxt)
        nxt += max(1, sectors(len(d)))
    total = nxt

    used = set()
    short = [iso_name(n, used) for n in names]
    joliet = [n.encode("utf-16-be")[:128] for n in names]

    def root_dir(self_extent, entry_names):
        body = dir_record(b"\x00", self_extent, SECTOR, True, now) + dir_record(b"\x01", self_extent, SECTOR, True, now)
        for nm, ext, d in zip(entry_names, extents, datas):
            body += dir_record(nm, ext, len(d), False, now)
        assert len(body) <= SECTOR, "arquivos demais para um diretório de um setor"
        return pad(body, SECTOR, b"\x00")

    def path_table(root_extent, big):
        pack = (lambda f, v: struct.pack(">" + f, v)) if big else (lambda f, v: struct.pack("<" + f, v))
        return pad(bytes([1, 0]) + pack("I", root_extent) + pack("H", 1) + b"\x00\x00", SECTOR, b"\x00")

    def volume_descriptor(kind, joliet_vd, root_extent, ptl, ptm):
        enc = (lambda s, n: pad(s.encode("utf-16-be"), n, b"\x00 ")[:n]) if joliet_vd else (lambda s, n: pad(s.encode("ascii"), n))
        vd = bytes([kind]) + b"CD001" + bytes([1, 0])
        vd += enc("LINUX", 32) + enc(LABEL, 32) + b"\x00" * 8 + both32(total)
        vd += (b"%/E" + b"\x00" * 29) if joliet_vd else b"\x00" * 32
        vd += both16(1) + both16(1) + both16(SECTOR) + both32(10)
        vd += struct.pack("<I", ptl) + struct.pack("<I", 0) + struct.pack(">I", ptm) + struct.pack(">I", 0)
        vd += dir_record(b"\x00", root_extent, SECTOR, True, now)
        vd += enc("", 128) + enc("BTS COMPRESS", 128) + enc("", 128) + enc("GERAR-SEED-ISO", 128)
        vd += enc("", 37) + enc("", 37) + enc("", 37)
        vd += vol_time(now) + vol_time(now) + b"0" * 16 + b"\x00" + b"0" * 16 + b"\x00"
        vd += b"\x01\x00"
        return pad(vd, SECTOR, b"\x00")

    with open(out, "wb") as f:
        f.write(b"\x00" * SECTOR * 16)
        f.write(volume_descriptor(1, False, ROOT, PT_L, PT_M))
        f.write(volume_descriptor(2, True, JROOT, JPT_L, JPT_M))
        f.write(pad(bytes([255]) + b"CD001" + b"\x01", SECTOR, b"\x00"))
        f.write(path_table(ROOT, False)); f.write(path_table(ROOT, True))
        f.write(path_table(JROOT, False)); f.write(path_table(JROOT, True))
        f.write(root_dir(ROOT, short))
        f.write(root_dir(JROOT, joliet))
        for d in datas:
            f.write(d)
            f.write(b"\x00" * ((-len(d)) % SECTOR or (SECTOR if not d else 0)))
    return total * SECTOR


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    size = build(sys.argv[1], sys.argv[2:])
    print(f"ISO criada: {sys.argv[1]} ({size / 1024:.0f} KB), rótulo {LABEL}")
