import axios from 'axios';
import { Hono } from 'hono';
import { env } from 'hono/adapter';
import { Client, MixPlaylist, Playlist } from "youtubei";

function parseDurationToSeconds(duration: string): number {
  const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/)
  if (!match) return 0

  const hours = parseInt(match[1]) || 0
  const minutes = parseInt(match[2]) || 0
  const seconds = parseInt(match[3]) || 0

  return hours * 3600 + minutes * 60 + seconds
}

const app = new Hono()

app.get('/', (c) => {
  return c.redirect("https://github.com/boring-design/youtube-metadata-service")
})

app.get('/video', async (c) => {
  const url = c.req.query('url')

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

    if (!videoId) {
      return c.json({ error: 'Invalid YouTube URL. Missing video ID' }, 400)
    }

    const apiKey = env<{ YOUTUBE_API_KEY: string }>(c).YOUTUBE_API_KEY
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoId}&key=${apiKey}`

    const response = await axios.get(apiUrl)
    const videoData = response.data.items[0]

    if (!videoData) {
      return c.json({ error: 'Video not found' }, 404)
    }

    const metadata = {
      videoId,
      listId,
      title: videoData.snippet.title,
      description: videoData.snippet.description,
      publishedAt: videoData.snippet.publishedAt,
      channelTitle: videoData.snippet.channelTitle,
      viewCount: videoData.statistics.viewCount,
      likeCount: videoData.statistics.likeCount,
      commentCount: videoData.statistics.commentCount,
      thumbnail: videoData.snippet.thumbnails.maxres.url,
      author: videoData.snippet.channelTitle,
      durationInSeconds: parseDurationToSeconds(videoData.contentDetails.duration),
    }

    return c.json(metadata)
  } catch (error) {
    console.error('Error fetching video metadata:', error)
    return c.json({ error: 'Error fetching video metadata' }, 500)
  }
})

const youtube = new Client()

app.get('/playlist', async (c) => {
  const url = c.req.query('url')

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

    const playlist = await youtube.getPlaylist(listId)

    if (playlist instanceof MixPlaylist) {
      return c.json({
        title: playlist.title,
        videoCount: playlist.videoCount,
        videos: playlist.videos.map((video) => ({
          title: video.title,
          author: video.channel?.name,
          videoId: video.id,
          thumbnail: video.thumbnails[video.thumbnails.length-1].url,
          durationInSeconds: video.duration,
        })),
      })
    } else if (playlist instanceof Playlist) {
      return c.json({
        title: playlist.title,
        videoCount: playlist.videoCount,
        videos: playlist.videos.items.map((video) => ({
          title: video.title,
          author: video.channel?.name,
          videoId: video.id,
          thumbnail: video.thumbnails[video.thumbnails.length-1].url,
          durationInSeconds: video.duration,
        })),
      })
    } else {
      return c.json({ error: 'Playlist not found or invalid' }, 404)
    }
  } catch (error) {
    console.error('Error fetching playlist metadata:', error)
    return c.json({ error: 'Error fetching playlist metadata' }, 500)
  }
})

export default app
