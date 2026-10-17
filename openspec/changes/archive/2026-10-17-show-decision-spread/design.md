## Context

Существующие rankAlternatives и probabilityDifference уже сравнивают точные W/N. Новая чистая функция decisionSpread в public/impact.js использует их; выбранным шагом и результатами раундов по-прежнему владеет public/app.js.

## Decisions

Показатели выводятся рядом со статусом выбора. При одном кандидате gap = null, при терминале range = gap = null. Форматирование остаётся в formatPointDifference, вычислительные дроби не округляются. Новых кешей нет.

Источник идеи: различать разрыв кандидатов и уверенность (PlayDomino, Mesa Quince), каталог docs/domino-analysis-sources.md. Эвристические шкалы и симуляции источников не переносятся в наш точный критерий.
