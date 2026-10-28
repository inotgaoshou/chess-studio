#!/usr/bin/env python3
"""Check the mobile catalog's real first/next page without printing credentials."""
import argparse
import json
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--credentials', type=Path, required=True)
parser.add_argument('--base-url', help='Optional read-only preview origin')
parser.add_argument('--deadline', type=float, default=1)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
credentials = json.loads(args.credentials.read_text())
login_origin = credentials['api'].rstrip('/')
origin = (args.base_url or login_origin).rstrip('/')
results = []


def request(path, token=None, body=None):
    headers = {'Content-Type': 'application/json', 'x-xiangqi-app-id': 'student-web'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = Request((origin if token else login_origin) + path, headers=headers,
                  data=json.dumps(body).encode() if body else None)
    started = time.monotonic()
    with urlopen(req, timeout=max(15, args.deadline)) as response:
        result = json.load(response)
    elapsed = round(time.monotonic() - started, 3)
    return result, elapsed


try:
    account = credentials['student']
    auth, _ = request('/api/v1/auth/login', body={
        'account': account['loginName'], 'password': account['password']})
    token = auth['token']
    query = {'view': 'structure', 'availability': 'available', 'allowStaleCounts': 'true', 'limit': 50}
    root, elapsed = request('/api/v1/student/teaching-catalog/browse?' + urlencode(query), token)
    node = next(n for n in root['children'] if n.get('teachingEntry') == 'practical_endgames')
    results.append({'request': 'root', 'seconds': elapsed})
    query.update(nodeId=node['id'], includeMateSteps='true')
    _, elapsed = request('/api/v1/student/teaching-catalog/browse?' + urlencode(query), token)
    results.append({'request': 'structure', 'seconds': elapsed})
    query['view'] = 'counts'
    counts, elapsed = request('/api/v1/student/teaching-catalog/browse?' + urlencode(query), token)
    assert counts.get('currentNode', {}).get('itemCount', 0) > 0, 'Expected available endgame questions'
    results.append({'request': 'counts', 'seconds': elapsed})
    seen = set()
    cursor = None
    for page in (1, 2):
        query = {'limit': 20, 'pageOnly': 'true'}
        if cursor:
            query['cursor'] = cursor
        body, elapsed = request('/api/v1/student/teaching-catalog/' + node['id'] + '/problems?' + urlencode(query), token)
        ids = [item['id'] for item in body['items']]
        assert len(ids) == 20, 'Expected 20 practical endgame questions'
        assert len(set(ids)) == len(ids) and not seen.intersection(ids), 'Duplicate page items'
        seen.update(ids)
        cursor = body.get('nextCursor')
        assert cursor, 'Expected a next-page cursor'
        results.append({'request': 'items', 'page': page, 'seconds': elapsed, 'items': len(ids), 'unique': True})
    assert all(result['seconds'] < args.deadline for result in results), 'Catalog response exceeded the acceptance deadline'
except Exception as error:
    results.append({'passed': False, 'error': type(error).__name__, 'failedRequest': 'items' if len(results) >= 2 else 'catalog'})
    raise SystemExit(1)
else:
    results.append({'passed': True})
finally:
    args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(results, ensure_ascii=False), flush=True)
