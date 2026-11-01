import { Hono } from 'hono';
import { env } from 'hono/adapter';
import { cors } from 'hono/cors';

function parseDurationToSeconds(duration: string): number {
  const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/)
  if (!match) return 0

  const hours = parseInt(match[1]) || 0
  const minutes = parseInt(match[2]) || 0
  const seconds = parseInt(match[3]) || 0

  return hours * 3600 + minutes * 60 + seconds
}


async function getVideoData(videoId: string, apiKey: string) {
  const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoId}&key=${apiKey}`;
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`YouTube API error: ${response.status}`);
  }
  const data = await response.json() as { items: any[] };
  const videoData = data.items[0];

  if (!videoData) {
    throw new Error('Video not found');
  }

  return {
    videoId,
    title: videoData.snippet.title,
    description: videoData.snippet.description,
    publishedAt: videoData.snippet.publishedAt,
    channelTitle: videoData.snippet.channelTitle,
    viewCount: videoData.statistics.viewCount,
    likeCount: videoData.statistics.likeCount,
    commentCount: videoData.statistics.commentCount,
    thumbnail: videoData.snippet.thumbnails.high.url,
    author: videoData.snippet.channelTitle,
    durationInSeconds: parseDurationToSeconds(videoData.contentDetails.duration),
  };
}

const app = new Hono()

app.get('/', (c) => {
  return c.redirect("https://github.com/boring-design/youtube-metadata-service")
})

app.get('/video', async (c) => {
  const url = c.req.query('url');

  if (!url) {
    return c.json({ error: 'Missing URL parameter' }, 400);
  }

  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.hostname.endsWith('youtube.com')) {
      return c.json({ error: 'Invalid URL. Please provide a YouTube URL' }, 400);
    }

    const videoId = parsedUrl.searchParams.get('v');
    const listId = parsedUrl.searchParams.get('list');

    if (!videoId) {
      return c.json({ error: 'Invalid YouTube URL. Missing video ID' }, 400);
    }

    const apiKey = env<{ YOUTUBE_API_KEY: string }>(c).YOUTUBE_API_KEY;
    const metadata = await getVideoData(videoId, apiKey);

    return c.json({ ...metadata, listId });
  } catch (error) {
    console.error('Error fetching video metadata:', error);
    return c.json({ error: 'Error fetching video metadata' }, 500);
  }
})

app.get('/iframe_api', cors({ origin: '*' }), async (c) => {
  const response = await fetch('https://www.youtube.com/iframe_api');
  const body = await response.text();
  return new Response(body, {
    headers: {
      'Content-Type': 'application/javascript',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

export default app
