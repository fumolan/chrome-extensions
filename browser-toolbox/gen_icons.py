# 生成扩展图标：蓝底圆角方块 + 白色"工"字。改色/改字后重跑：py -3 gen_icons.py
from PIL import Image, ImageDraw, ImageFont
import os

SIZES = [16, 48, 128]
BG = (9, 105, 218, 255)  # #0969da
FONT = 'C:/Windows/Fonts/msyhbd.ttc'  # 微软雅黑粗体

os.makedirs('icons', exist_ok=True)
for size in SIZES:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=BG)
    f = ImageFont.truetype(FONT, int(size * 0.62))
    bbox = d.textbbox((0, 0), '工', font=f)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), '工', font=f, fill=(255, 255, 255, 255))
    img.save(f'icons/icon{size}.png')
    print(f'icons/icon{size}.png')
