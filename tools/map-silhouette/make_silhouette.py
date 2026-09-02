# -*- coding: utf-8 -*-
"""
Силуэт Курганской области без фона.

Исходник `kurgan-oblast-outline.svg` — карта из Викисклада: фоновый прямоугольник
1000x736 цвета #f5f5f5, поверх — соседние регионы (#e0e0e0), районы области
(#fefee9), реки и дороги. На тёмной карте он выводился через
`filter: invert(1)`, из-за чего белый фон становился тёмно-серым
прямоугольником — то самое «как будто окно» с ВКС 24.08.2026.

Берём только районы области и склеиваем в одну группу сплошной заливкой.
Прозрачность задаёт уже сама карта атрибутом opacity на <image>: если гасить
каждый путь по отдельности, на общих границах районов прозрачность
складывается и проступает сетка швов.
"""
import io
import re

SRC = ("D:/dev/axel_actual/axel_server_ready/axel_server_ready/frontend/"
       "public/maps/kurgan-oblast-outline.svg")
DST = ("D:/dev/axel_actual/axel_server_ready/axel_server_ready/frontend/"
       "public/maps/kurgan-oblast-silhouette.svg")

source = io.open(SRC, encoding="utf-8").read()

start = source.find('<g\n     id="g6632"')
if start < 0:
    start = re.search(r'<g\b[^>]*id="g6632"', source).start()
end = source.find("</g>", start)
group = source[start:end]

paths = re.findall(r'\sd="([^"]*)"', group)
assert len(paths) >= 20, len(paths)

body = "\n".join('    <path d="%s" />' % d.strip() for d in paths)
result = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="61.7 54 1000 736">\n'
    '  <!-- Районы Курганской области из карты Викисклада, одной сплошной'
    ' заливкой. Прозрачность задаётся на стороне карты. -->\n'
    '  <g fill="#ffffff" stroke="none">\n'
    + body
    + "\n  </g>\n</svg>\n"
)
io.open(DST, "w", encoding="utf-8").write(result)

print("путей перенесено:", len(paths))
print("размер исходника:", len(source), "-> силуэта:", len(result))
print("фоновый прямоугольник в силуэте:", "rect" in result)
print("сохранено:", DST)
