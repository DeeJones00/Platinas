"""Brazilian Portuguese trophy names and descriptions of The Witcher 3.

Source: the Steam achievement list in Brazilian Portuguese (CD Projekt RED's own localization), saved in
trophies_pt.json (keys are the achievement numbers of the guide, 1-78). The PlayStation registry could not be
reached (the sites that mirror it block automated access); PlayStation usually reuses the same localization.
"""
import json
import os

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'trophies_pt.json'), encoding='utf8') as f:
    _DATA = json.load(f)

PT = {int(n): (v['name'], v['desc']) for n, v in _DATA.items()}
# Extra reasons the guide gives for a missable trophy
MISSABLE_NOTE = {
    11: 'É possível concluir todos os Contratos sem desbloquear este troféu.',
    59: 'Só é perdível se você não concluir o primeiro Pesadelo (o do gazebo) antes de entrar na mansão.',
}
