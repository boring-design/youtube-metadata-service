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

// Regular playlists come from the official YouTube Data API. YouTube changed
// the format of its internal web API, and youtubei can no longer read the
// videos of a regular playlist. Mix playlists (id starts with "RD") have no
// official API; the Aeir app reads them on the device.
const PLAYLIST_PAGE_SIZE = 50;
const PLAYLIST_MAX_PAGES = 4;

async function getJSON(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`YouTube API error: ${response.status}`);
  }
  return response.json();
}

async function getPlaylistData(listId: string, videoId: string | null, apiKey: string) {
  const api = 'https://www.googleapis.com/youtube/v3';
  const playlistResponse = await getJSON(`${api}/playlists?part=snippet,contentDetails&id=${listId}&key=${apiKey}`);
  const playlist = playlistResponse.items[0];
  if (!playlist) {
    return null;
  }

  const videoIds: string[] = [];
  let pageToken = '';
  for (let page = 0; page < PLAYLIST_MAX_PAGES; page++) {
    const itemsResponse = await getJSON(`${api}/playlistItems?part=contentDetails&maxResults=${PLAYLIST_PAGE_SIZE}&playlistId=${listId}&key=${apiKey}${pageToken ? `&pageToken=${pageToken}` : ''}`);
    videoIds.push(...itemsResponse.items.map((item: any) => item.contentDetails.videoId));
    pageToken = itemsResponse.nextPageToken;
    if (!pageToken) break;
  }

  // Private and deleted videos are not returned here, so they are left out.
  const videosById = new Map<string, any>();
  for (let i = 0; i < videoIds.length; i += PLAYLIST_PAGE_SIZE) {
    const ids = videoIds.slice(i, i + PLAYLIST_PAGE_SIZE).join(',');
    const videosResponse = await getJSON(`${api}/videos?part=snippet,contentDetails&id=${ids}&key=${apiKey}`);
    for (const video of videosResponse.items) {
      videosById.set(video.id, video);
    }
  }

  let videos = videoIds.filter((id) => videosById.has(id)).map((id) => {
    const video = videosById.get(id);
    const thumbnails = video.snippet.thumbnails;
    const thumbnail = thumbnails.maxres ?? thumbnails.standard ?? thumbnails.high ?? thumbnails.medium ?? thumbnails.default;
    return {
      title: video.snippet.title,
      author: video.snippet.channelTitle,
      videoId: id,
      thumbnail: thumbnail.url,
      durationInSeconds: parseDurationToSeconds(video.contentDetails.duration),
    };
  });

  let videoIndexInPlaylist = videos.findIndex((v) => v.videoId === videoId);
  if (videoId && videoIndexInPlaylist === -1) {
    try {
      const newVideo = await getVideoData(videoId, apiKey);
      videos = [newVideo, ...videos];
      videoIndexInPlaylist = 0;
    } catch (error) {
      console.error('Error fetching video info:', error);
    }
  }

  return {
    title: playlist.snippet.title,
    videoIndexInPlaylist: videoIndexInPlaylist !== -1 ? videoIndexInPlaylist : null,
    videoCount: playlist.contentDetails.itemCount,
    videos,
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

app.get('/playlist', async (c) => {
  const url = c.req.query('url')
  const apiKey = env<{ YOUTUBE_API_KEY: string }>(c).YOUTUBE_API_KEY

  if (!url) {
    return c.json({ error: 'Missing URL parameter' }, 400)
  }

  try {
    const parsedUrl = new URL(url)
    if (!parsedUrl.hostname.endsWith('youtube.com')) {
      return c.json({ error: 'Invalid URL. Please provide a YouTube URL' }, 400)
    }

    const videoId = parsedUrl.searchParams.get('v')
    const listId = parsedUrl.searchParams.get('list')

    if (!listId) {
      return c.json({ error: 'Invalid YouTube URL. Missing playlist ID' }, 400)
    }
    if (listId.startsWith('RD')) {
      return c.json({ error: 'Mix playlists are not supported here' }, 400)
    }

    const result = await getPlaylistData(listId, videoId, apiKey)
    if (!result) {
      return c.json({ error: 'Playlist not found or invalid' }, 404)
    }
    return c.json(result)
  } catch (error) {
    console.error('Error fetching playlist metadata:', error)
    return c.json({ error: 'Error fetching playlist metadata' }, 500)
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
