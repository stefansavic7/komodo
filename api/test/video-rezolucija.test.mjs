// Feed pušta najviše 720p (VIDEO_MAX_P), bez obzira na najveću rezoluciju koju je Bunny napravio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pustiRezoluciju } from '../src/video.js';

test('1080p snimak se pušta u 720p, manji ostaju kakvi jesu', () => {
  assert.equal(pustiRezoluciju('1080p'), '720p');
  assert.equal(pustiRezoluciju('720p'), '720p');
  assert.equal(pustiRezoluciju('360p'), '360p');
  assert.equal(pustiRezoluciju('240p'), '240p');
  assert.equal(pustiRezoluciju(null), '360p');
});
