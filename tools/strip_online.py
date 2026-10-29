# -*- coding: utf-8 -*-
"""Удаляет из ui.js режим просмотра и синхронизацию (общий доступ)."""
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = os.path.join(ROOT, 'app', 'js', 'ui.js')
src = io.open(path, encoding='utf-8').read()
orig = src
removed = []


def cut(pattern, flags=0, note=''):
    global src
    new = re.sub(pattern, '', src, flags=flags)
    if new != src:
        removed.append(note or pattern[:50])
        src = new
    else:
        removed.append('НЕ НАЙДЕНО: ' + (note or pattern[:50]))


# 1. состояние
cut(r"\n    readOnly: false,", note='state.readOnly')
cut(r"\n    state\.readOnly = !!\(await DB\.getSet\('readOnly', false\)\);", note='загрузка readOnly')

# 2. тосты «режим просмотра»
cut(r"\n\s*if \(state\.readOnly\) \{ toast\('Режим просмотра[^']*'\); return; \}", note='проверки режима', flags=0)
for _ in range(8):
    n = src
    src = re.sub(r"\n[ \t]*if \(state\.readOnly\) \{ toast\('Режим просмотра[^']*'\); return; \}", '', src)
    if src == n:
        break

# 3. кнопка замка в шапке
cut(r"\n\s*\$\('#btnLock'\)\.style\.display = state\.readOnly \? 'none' : '';", note='кнопка замка (вид)')
cut(r"\n\s*\$\('#btnLock'\)\.addEventListener\('click'[\s\S]*?\n      \}\);", note='кнопка замка (обработчик)')

# 4. панель «режим просмотра» в настройках
cut(r"\n\s*\$\('#roInfo'\)\.textContent = state\.readOnly \? 'включён' : 'выключен';", note='индикатор режима')
cut(r"\n\s*\$\('#btnReadOnly'\)\.addEventListener\('click'[\s\S]*?\n      \}\);", note='переключатель режима')

# 5. импорт: больше не переключает в режим просмотра
cut(r"\n\s*if \(pack\.kind === 'invite'\) await DB\.set\('readOnly', true\);", note='импорт приглашения')
cut(r"\n\s*await DB\.set\('readOnly', true\);\n\s*state\.readOnly = true;", note='импорт: readOnly')

# 6. синхронизация
cut(r"\n\s*if \(global\.Sync && global\.Sync\.connected\(\) && global\.Sync\.cfg\.role !== 'read'\) \{\n\s*global\.Sync\.pushMeta\(\)\.catch\(\(\) => \{\}\);\n\s*\}", note='Sync.pushMeta (журнал)')
cut(r"\n\s*if \(global\.Sync && global\.Sync\.connected\(\) && global\.Sync\.cfg\.role !== 'read'\) \{\n\s*global\.Sync\.push\(\)\.catch\(\(\) => \{\}\);\n\s*\}", note='Sync.push (событие)')
cut(r"\n\s*if \(global\.Sync && global\.Sync\.connected\(\)\) global\.Sync\.pushMeta\(\);", note='Sync.pushMeta (объект)')
cut(r"\n\s*if \(global\.Sync\) \{\n(?:.*\n)*?\s*\}\n", note='обработчики Sync', flags=0)

# 7. пустые блоки
src = re.sub(r"\n[ \t]*\n[ \t]*\n", '\n\n', src)

io.open(path, 'w', encoding='utf-8', newline='').write(src)
print('изменён:', len(src) != len(orig))
for r in removed:
    print('  -', r)
print('осталось упоминаний readOnly:', len(re.findall(r'readOnly', src)))
print('осталось упоминаний Sync:', len(re.findall(r'\bSync\b', src)))
