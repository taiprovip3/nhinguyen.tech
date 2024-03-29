const express = require('express')
const { authenticateToken } = require('../utils/oauth-middleware')
const { getConnectionPool, preparedStamentMysqlQuery } = require('../utils/mysql-factory-db')
const router = express.Router()
require('dotenv').config()
const Transaction = require('../models/transaction')
const generateRandomString2 = require('../utils/generate-random-string')

router.get('/servers', async (req, res) => {
  const serversString = process.env.SERVER_TYPES
  const serversArray = serversString.split(',')
  return res.status(200).json(serversArray)
})

router.get('/servers/getPlayerCoins', authenticateToken, async (req, res) => {
  const serverName = req.query.server
  if (!serverName) {
    return res.status(500).send('No server name params found')
  }
  const mainPool = getConnectionPool('main')
  const conn = await mainPool.getConnection()
  try {
    const username = req.session.user.username
    const uuidSqlQuery = 'SELECT uuid FROM users WHERE username = ?';
    const uuidResult = await preparedStamentMysqlQuery(conn, uuidSqlQuery, [username]);
    const uuid = uuidResult[0].uuid

    const serverPool = await getConnectionPool(serverName)
    const playerCoinQuery = 'SELECT * FROM playerpoints_points WHERE uuid = ?'
    const [result] = await serverPool.query(playerCoinQuery, [uuid])
    if (!result) {
      return res.status(500).send(`not found user ${username} with uuid ${uuid}`)
    }
    const playerStatResponse = {
      username,
      uuid,
      coins: result[0].points,
    }
    return res.status(200).json(playerStatResponse)
  } catch (error) {
    console.error('/servers/getPlayerCoins error', error)
    return res.status(500).send(error)
  } finally {
    conn.release()
  }
})

router.post('/servers/forwardCoins', authenticateToken, async (req, res) => {
  const balanceToForward = Number(req.body.balanceToForward)
  const serverName = req.body.serverName
  if (!balanceToForward || !serverName) {
    const sweetResponse = {
      title: 'Lỗi',
      text: 'Missing balanceToForward or serverName to forward',
      icon: 'error',
    }
    return res.json(sweetResponse)
  }
  const mainPool = getConnectionPool('main')
  const conn = await mainPool.getConnection()
  try {
    const username = req.session.user.username
    const uuidSqlQuery = 'SELECT u.uuid, p.balance FROM users u INNER JOIN profiles p ON u.id = p.users_id WHERE u.username = ?';
    const uuidResult = await preparedStamentMysqlQuery(conn, uuidSqlQuery, [username]);
    const uuidData = uuidResult[0];
    const balanceAvaiable = uuidData.balance
    if (balanceToForward > balanceAvaiable) {
      const sweetResponse = {
        title: 'Không đủ xu để chuyển',
        text: `Bạn không thể chuyển số xu vượt quá > ${balanceAvaiable} 🥮.`,
        icon: 'error',
      }
      return res.json(sweetResponse)
    }
    const serverPool = await getConnectionPool(serverName)
    const uuid = uuidData.uuid;
    const playerCoinQuery = `SELECT * FROM playerpoints_points WHERE uuid = ?`
    const [result] = await serverPool.query(playerCoinQuery, [uuid])
    if (!result) {
      const sweetResponse = {
        title: 'Lỗi',
        text: `Không tìm thấy dữ liệu user ${username} trong máy chủ ${serverName}.`,
        icon: 'error',
      }
      return res.json(sweetResponse)
    }
    /**Chuyển tiền vào server */
    const userId = req.session.user.userId
    try {
      await conn.beginTransaction();
      await conn.execute('UPDATE profiles SET balance = balance - ? WHERE users_id = ?', [balanceToForward, userId]);
      await serverPool.query('UPDATE playerpoints_points SET points = points + ? WHERE uuid = ?', [
        balanceToForward,
        uuid,
      ])
      await conn.commit();
      const balanceLeft = balanceAvaiable - balanceToForward
      const newPayload = { ...req.session.user, balance: balanceLeft }
      req.session.user = newPayload
      const newTransaction = new Transaction({
        userId,
        transId: generateRandomString2(32),
        amount: balanceToForward,
        bankCode: process.env.SERVER_NAME,
        message: `CHUYEN THANH CONG ${balanceToForward} 🥮 XU VAO SERVER ${serverName}. SO DU CON LAI: ${balanceLeft}`,
        status: 'SUCCESS',
      })
      await newTransaction.save()
      const sweetResponse = {
        title: 'Chuyển xu thành công',
        text: 'Vui lòng tải lại trang và vào game kiểm tra.',
        icon: 'success',
      }
      return res.json(sweetResponse)
    } catch (error) {
      // Catch của pg
      console.error('/servers/forwardCoins error2=', error)
      conn.rollback();
      return res.status(500).send('Transaction thất bại. Cập nhật giao dịch không thành công do lỗi máy chủ')
    } finally {
      conn.release()
    }
  } catch (error) {
    switch (error.code) {
      case 'ECONNREFUSED':
        return res.status(500).send(`(${error.code}) Không thể kết nối tối csdl của máy chủ ${serverName}`)
      case 'ER_NO_SUCH_TABLE':
        return res.status(500).send(`(${error.code}) Admini chưa liên kết xu với csdl ${serverName}`)
      default:
        break
    }
    console.error('/servers/forwardCoins error1=', error)
    return res.status(500).send(error)
  }
})

module.exports = router
