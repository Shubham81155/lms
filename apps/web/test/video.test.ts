import { describe, it, expect } from 'vitest';
import { videoSource } from '../src/lib/video';

describe('videoSource', () => {
  it('turns YouTube pages into the privacy-enhanced embed', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    ]) {
      expect(videoSource(url), url).toEqual({ kind: 'youtube', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0' });
    }
    expect(videoSource('https://youtu.be/dQw4w9WgXcQ?t=42')?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=42');
  });

  it('turns Vimeo pages into the Vimeo player', () => {
    expect(videoSource('https://vimeo.com/76979871')).toEqual({ kind: 'vimeo', src: 'https://player.vimeo.com/video/76979871' });
    expect(videoSource('https://player.vimeo.com/video/76979871?h=abc')).toEqual({
      kind: 'vimeo',
      src: 'https://player.vimeo.com/video/76979871',
    });
  });

  it('plays media files directly and links everything else', () => {
    expect(videoSource('https://cdn.example.edu/lectures/week1.mp4')).toEqual({
      kind: 'file',
      src: 'https://cdn.example.edu/lectures/week1.mp4',
    });
    expect(videoSource('https://cdn.example.edu/a.webm?token=1')?.kind).toBe('file');
    expect(videoSource('https://stream.example.edu/watch/123')).toEqual({ kind: 'link', src: 'https://stream.example.edu/watch/123' });
    expect(videoSource('https://www.youtube.com/watch?v=')?.kind).toBe('link');
  });

  it('rejects anything that is not an http(s) address', () => {
    expect(videoSource('javascript:alert(1)')).toBeNull();
    expect(videoSource('not a url')).toBeNull();
    expect(videoSource('data:video/mp4;base64,AAAA')).toBeNull();
  });
});
