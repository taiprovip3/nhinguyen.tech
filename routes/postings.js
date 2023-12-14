const { default: axios } = require('axios')
const express = require('express')
const pool = require('../utils/db')
const helper = require('../utils/calculate-timestamp')
const { authenticateToken } = require('../utils/oauth-middleware')
const router = express.Router()

router.get('/postings', async (req, res) => {
  const userData = req.session.user
  let payload = { userData }
  const queryResult = await pool.query('SELECT * FROM server_metrics')
  const queryRow = queryResult.rows[0]
  // serverMetrics
  payload['serverMetrics'] = queryRow
  // serverStatus
  const queryMembersResult = await pool.query('SELECT COUNT(*) FROM users WHERE is_verified = TRUE')
  const members = queryMembersResult.rows[0].count
  const serverStatusResponse = await axios.get('https://api.mcstatus.io/v2/status/java/play.hypixel.net:25565')
  const onlinePlayers = serverStatusResponse.data.players.online
  const maxPlayers = serverStatusResponse.data.players.max
  const serverStatus = { onlinePlayers, maxPlayers, members }
  payload['serverStatus'] = serverStatus
  const queryTitlesResult = await pool.query('SELECT title FROM posts ORDER BY created_at DESC')
  const tiles = queryTitlesResult.rows
  const eventTitles = tiles.map((e) => {
    return e.title
  })
  payload['eventTitles'] = eventTitles
  // posts
  const queryPostsResult = await pool.query('SELECT * FROM posts ORDER BY post_id DESC')
  const posts = queryPostsResult.rows
  payload['posts'] = posts
  // method caltimeago
  return res.render('postings', { payload, helper })
})

router.post('/postings', authenticateToken, async (req, res) => {
  const { title, content } = req.body
  if (!title) {
    const sweetResponse = {
      title: 'LỖI',
      text: 'Thiếu tiêu đề bài viết',
      icon: 'error',
    }
    return res.json(sweetResponse)
  }
  try {
    const userId = req.session.user.userId
    await pool.query('INSERT INTO posts (title, content, users_id) VALUES ($1, $2, $3) RETURNING *', [
      title,
      content,
      userId,
    ])
    const sweetResponse = {
      title: 'ĐĂNG TẢI THÀNH CÔNG',
      text: 'Nếu không nhìn thấy bài viết sự kiện mới, vui lòng bấm TẢI LẠI trang bằng ctrl + R nhé',
      icon: 'success',
    }
    return res.json(sweetResponse)
  } catch (error) {
    console.error('/posting error=', error)
    return res.status(500).send('Internal Server Error')
  }
})

module.exports = router
