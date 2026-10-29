# -*- coding: utf-8 -*-
"""Генерация иконок приложения АрендаЛог."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = r"C:\Users\user\Desktop\восток\arendalog\android\res"
DENS = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
SS = 4  # суперсэмплинг

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\tahomabd.ttf",
]


def font_of(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def make(size):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # фон: вертикальный градиент
    top = (28, 44, 78)
    bot = (12, 17, 23)
    for y in range(S):
        t = y / max(1, S - 1)
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        d.line([(0, y), (S, y)], fill=c + (255,))

    # маска со скруглением
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    r = int(S * 0.23)
    md.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=255)
    img.putalpha(mask)

    # синее свечение сверху
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-S * 0.35, -S * 0.75, S * 1.15, S * 0.45], fill=(76, 141, 255, 110))
    img = Image.alpha_composite(img, glow)
    img.putalpha(mask)

    d = ImageDraw.Draw(img)

    # буква А
    f = font_of(int(S * 0.62))
    text = "А"
    bbox = d.textbbox((0, 0), text, font=f)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    d.text(((S - tw) / 2 - bbox[0], (S - th) / 2 - bbox[1] - int(S * 0.03)), text,
           font=f, fill=(255, 255, 255, 255))

    # галочка в правом нижнем углу
    cx, cy, rad = int(S * 0.735), int(S * 0.735), int(S * 0.155)
    d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=(47, 191, 113, 255))
    w = max(2, int(S * 0.028))
    d.line([(cx - rad * 0.45, cy + rad * 0.02), (cx - rad * 0.08, cy + rad * 0.4)], fill=(255, 255, 255, 255), width=w)
    d.line([(cx - rad * 0.08, cy + rad * 0.4), (cx + rad * 0.48, cy - rad * 0.38)], fill=(255, 255, 255, 255), width=w)

    return img.resize((size, size), Image.LANCZOS)


for dens, size in DENS.items():
    folder = os.path.join(OUT, "mipmap-" + dens)
    os.makedirs(folder, exist_ok=True)
    im = make(size)
    path = os.path.join(folder, "ic_launcher.png")
    im.save(path, "PNG")
    print("%-8s %3dpx  %s" % (dens, size, path))

# крупная версия для README
big = make(512)
big.save(r"C:\Users\user\Desktop\восток\arendalog\docs\icon-512.png")
print("docs/icon-512.png")
