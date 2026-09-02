# -*- coding: utf-8 -*-
"""
Книга от 18.08.2026 сериализована с префиксом пространства имён SpreadsheetML
(<s:workbook>, <s:sheet>, <s:c>) вместо пространства по умолчанию. ExcelJS такое
не разбирает: листы не регистрируются, и загрузка падает на definedNames
(«Cannot set properties of undefined (setting 'sheetNo')»).

Скрипт переписывает только сериализацию XML — префикс убирается, пространство
имён становится основным. Ни одна ячейка не трогается; равенство содержимого
проверяется отдельно через xdiff.py по openpyxl, который читает оба варианта.
"""
import re
import shutil
import sys
import zipfile

# Пространства имён, которые в нормальной книге идут без префикса. core.xml сюда
# не входит: там `cp:coreProperties` — штатная запись, и ExcelJS её понимает.
DEFAULT_NAMESPACES = (
    'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
)


def unprefix(data: bytes) -> bytes:
    text = data.decode('utf-8')
    changed = False
    for namespace in DEFAULT_NAMESPACES:
        match = re.search(r'xmlns:(\w+)="%s"' % re.escape(namespace), text)
        if not match:
            continue
        prefix = match.group(1)
        text = text.replace(
            'xmlns:%s="%s"' % (prefix, namespace),
            'xmlns="%s"' % namespace,
        )
        text = text.replace('<%s:' % prefix, '<').replace('</%s:' % prefix, '</')
        # Атрибуты с этим же префиксом (`s:ref`) встречаются редко, но их тоже надо снять.
        text = re.sub(r'(\s)%s:' % re.escape(prefix), r'\1', text)
        changed = True
    return text.encode('utf-8') if changed else data


def main(src: str, dst: str) -> None:
    shutil.copyfile(src, dst)
    source = zipfile.ZipFile(src)
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as target:
        touched = []
        for item in source.infolist():
            data = source.read(item.filename)
            if item.filename.endswith('.xml'):
                converted = unprefix(data)
                if converted != data:
                    touched.append(item.filename)
                data = converted
            target.writestr(item, data)
    print('переписаны части:', ', '.join(touched) or 'нет')
    print('сохранено:', dst)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
