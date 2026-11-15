"""Check reconstructed directions against the bundled observer-centered JPL queries."""
import argparse
import hashlib
import json
from datetime import timedelta
from pathlib import Path

import numpy as np

from rebuild import local_track
from terrain import START, angle_samples, evaluate, jpl_request, metrics

ROOT = Path(__file__).resolve().parents[1]
VALIDATION_DAYS = 12
DEMO_START = 3 * 1440


def run(data, cache):
    radius = data['customGrid']['radius']
    dt = data['timeStep']
    steps = VALIDATION_DAYS * 1440 // dt + 1
    vectors = {target: np.array(track[:steps]) for target, track in data['bodyVectors'].items()}
    cases = []
    for site in data['sites'][:2]:
        observer = tuple(site[k] for k in ('id', 'name', 'lat', 'lon'))
        for height, target, code in ((2, 'earth', 399), (5, 'earth', 399), (2, 'sun', 10)):
            model = site['heights'][str(height)]
            alt = model['ground'] + height
            # The cached observers retain more altitude precision than the stored grid height.
            files = [file for file in cache.glob(f"{site['id']}_*_{code}_{dt}_11140000_11260000.txt")
                     if abs(float(file.name.split('_')[1]) - alt) <= .001]
            if len(files) != 1:
                raise ValueError(f"Expected one cached Horizons response for {site['id']} {target} at {height} m")
            file = files[0]
            altitude = float(file.name.split('_')[1])
            direct, url = jpl_request(cache, observer, altitude, code, dt, START, START + timedelta(days=VALIDATION_DAYS))
            projected = local_track(vectors[target], site['lat'], site['lon'], radius + altitude)
            direct_array, projected_array = np.array(direct), np.array(projected)
            if not np.array_equal(direct_array[:, 0], projected_array[:, 0]):
                raise ValueError('Mismatched ephemeris timestamps')
            az_delta = (projected_array[:, 1] - direct_array[:, 1] + 180) % 360 - 180
            el_delta = projected_array[:, 2] - direct_array[:, 2]

            def longest(track, day):
                return metrics(evaluate(track, day * 1440, model['terrain'][target],
                                        model['missing'], model['far'][target], step=data['azStep']))

            days = [(longest(direct, day), longest(projected, day)) for day in range(VALIDATION_DAYS)]
            shifts = [max(abs(a[k] - b[k]) for k in ('lower', 'upper')) for a, b in days]
            limb_radii = np.degrees(np.arcsin(
                (6378137 if target == 'earth' else 695700000) /
                np.linalg.norm(vectors[target], axis=1)
            ))
            demo_samples = [row for row in direct if DEMO_START <= row[0] < DEMO_START + 1440]
            skyline, gap = angle_samples(model['terrain'][target], model['missing'],
                                         [row[1] for row in demo_samples], data['azStep'])
            near_limb = sum(not bad and abs(row[2] - h) <= limb_radii[row[0] // dt]
                            for row, h, bad in zip(demo_samples, skyline, gap))
            cases.append(dict(site=site['name'], target=target, height=height, count=len(direct),
                              maxAzDeg=float(np.max(np.abs(az_delta))), maxElDeg=float(np.max(np.abs(el_delta))),
                              maxWindowShiftMin=max(shifts), demoShiftMin=shifts[3], nearLimbSamples=int(near_limb),
                              demoSampleCount=len(demo_samples), file=file.name, url=url,
                              sha256=hashlib.sha256(file.read_bytes()).hexdigest()))
    first, second = [site['heights']['2']['days'] for site in data['sites'][:2]]
    tie = data['rankingToleranceMinutes']
    a, b = ([day['terrain_earth'] for day in series] for series in (first, second))
    ranked = sum(x['upper'] + tie < y['lower'] or y['upper'] + tie < x['lower']
                 for x, y in zip(a, b))
    return dict(days=VALIDATION_DAYS, cases=cases, dailyRanked=ranked, dailyWindows=len(a))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=ROOT / 'validation' / 'horizons')
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    raw = (ROOT / 'data.js').read_text('utf8').strip()
    result = run(json.loads(raw.removeprefix('window.LUNAR_DATA=').removesuffix(';')), args.cache)
    payload = json.dumps(result, indent=2)
    if args.out:
        args.out.write_text('window.LUNAR_VALIDATION = ' + payload + ';\n', 'utf8')
    print(payload)


if __name__ == '__main__':
    main()
