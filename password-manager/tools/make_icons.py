# -*- coding: utf-8 -*-
"""生成扩展图标（深色圆角底 + 金色钥匙），纯标准库实现。"""
import os
import struct
import zlib

GOLD = (250, 204, 21, 255)
BG = (30, 41, 59, 255)
EMPTY = (0, 0, 0, 0)
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "extension", "icons")


def rounded_bg(size):
    px = [[EMPTY] * size for _ in range(size)]
    r = size * 0.225
    c = (size - 1) / 2
    for y in range(size):
        for x in range(size):
            dx = max(abs(x - c) - (size / 2 - r), 0)
            dy = max(abs(y - c) - (size / 2 - r), 0)
            if dx * dx + dy * dy <= r * r:
                px[y][x] = BG
    return px


def draw_key(px, size):
    def ring(cx, cy, ro, ri):
        for y in range(size):
            for x in range(size):
                d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                if ri <= d <= ro:
                    px[y][x] = GOLD

    def rect(x0, y0, x1, y1):
        for y in range(int(y0 * size), int(y1 * size) + 1):
            for x in range(int(x0 * size), int(x1 * size) + 1):
                if 0 <= x < size and 0 <= y < size:
                    px[y][x] = GOLD

    ring(0.34 * size, 0.42 * size, 0.155 * size, 0.072 * size)
    rect(0.47, 0.385, 0.80, 0.455)   # 杆
    rect(0.66, 0.455, 0.705, 0.58)   # 齿 1
    rect(0.755, 0.455, 0.80, 0.53)   # 齿 2


def write_png(path, px):
    h, w = len(px), len(px[0])
    raw = b"".join(b"\x00" + bytes(v for p in row for v in p) for row in px)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 32, 48, 128):
        px = rounded_bg(size)
        draw_key(px, size)
        out = os.path.join(OUT_DIR, f"icon{size}.png")
        write_png(out, px)
        print("wrote", os.path.normpath(out))


if __name__ == "__main__":
    main()
