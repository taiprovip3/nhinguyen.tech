const { default: axios } = require('axios')
const express = require('express')
const router = express.Router()
const moment = require('moment')
const crypto = require('crypto')
const Transaction = require('../models/transaction')
const logger = require('../utils/logger')
const generateRandomString2 = require('../utils/generate-random-string')
const { preparedStamentMysqlQuery, getConnectionPool } = require('../utils/mysql-factory-db')

router.post('/vnp/ibanking/create_payment_url', async (req, res) => {
  /** * req= [Object: null prototype] {
        ibanking_value: '10000',
        ibanking_bankcode: ''
      }
     */
  if (!req.body.ibanking_value) {
    return res.status(500).send('Đấy là bug chăng?')
  }
  let date = new Date()
  let createDate = moment(date).format('YYYYMMDDHHmmss')
  let ipAddr =
    req.headers['x-forwarded-for'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.connection.socket.remoteAddress

  // Set params for url
  let tmnCode = process.env.VNP_TMNCODE
  let secretKey = process.env.VNP_TMNCODE
  let vnpUrl = process.env.VNP_URL
  let returnUrl = process.env.VNP_RETURNURL
  let orderId = moment(date).format('DDHHmmss')
  let amount = req.body.ibanking_value
  let bankCode = req.body.ibanking_bankcode
  let locale = 'vn'
  let currCode = 'VND'
  let vnp_Params = {}

  vnp_Params['vnp_Version'] = '2.1.0'
  vnp_Params['vnp_Command'] = 'pay'
  vnp_Params['vnp_TmnCode'] = tmnCode
  vnp_Params['vnp_Locale'] = locale
  vnp_Params['vnp_CurrCode'] = currCode
  vnp_Params['vnp_TxnRef'] = orderId
  vnp_Params['vnp_OrderInfo'] = 'Thanh toan nap tien ibanking cho ma GD:' + orderId
  vnp_Params['vnp_OrderType'] = 'other'
  vnp_Params['vnp_Amount'] = amount * 100
  vnp_Params['vnp_ReturnUrl'] = returnUrl
  vnp_Params['vnp_IpAddr'] = ipAddr
  vnp_Params['vnp_CreateDate'] = createDate
  if (bankCode !== null && bankCode !== '') {
    vnp_Params['vnp_BankCode'] = bankCode
  }

  vnp_Params = sortObject(vnp_Params)
  console.log('vnp_Params=', vnp_Params)

  let querystring = require('qs')
  let signData = querystring.stringify(vnp_Params, { encode: false })
  let crypto = require('crypto')
  let hmac = crypto.createHmac('sha512', secretKey)
  let signed = hmac.update(new Buffer(signData, 'utf-8')).digest('hex')
  vnp_Params['vnp_SecureHash'] = signed
  vnpUrl += '?' + querystring.stringify(vnp_Params, { encode: false })

  return res.redirect(vnpUrl)
})

router.get('/get-vnp-banks', async (req, res) => {
  try {
    const formData = {
      tmn_code: process.env.VNP_TMNCODE,
    }
    const response = await axios.post('https://sandbox.vnpayment.vn/qrpayauth/api/merchant/get_bank_list', formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
    const banklist = response.data
    if (banklist) {
      return res.json(banklist)
    }
    return res.json([])
  } catch (error) {
    console.error(error.message)
  }
})

router.post('/gb/ibanking/create-payment', async (req, res) => {
  try {
    if (!req.body.ibanking_value || !req.body.ibanking_bankcode) {
      return res.status(500).send('Đấy là bug chăng?')
    }

    let date = new Date()
    let createDate = moment(date).format('YYYYMMDDHHmmss')

    let gb_Params = {}

    const userId = req.session.user.userId
    const username = process.env.GB_USERNAME
    const password = process.env.GB_PASSWORD
    const transId = generateRandomString(32)
    const bankCode = req.body.ibanking_bankcode
    const amount = req.body.ibanking_value
    const message = `Giao dich ibanking vao luc: ${createDate}`

    gb_Params['username'] = username
    gb_Params['password'] = password
    gb_Params['tran_id'] = transId
    gb_Params['bank_code'] = bankCode
    gb_Params['amount'] = amount
    gb_Params['message'] = message

    gb_Params = sortObject(gb_Params)
    console.log('sb_Params=', gb_Params)

    let querystring = require('qs')
    let gbUrl = process.env.GB_URL
    gbUrl += '?' + querystring.stringify(gb_Params, { encode: false })

    console.log('gbUrl=', gbUrl);

    const response = await axios.get(gbUrl)
    const gbReponseData = response.data

    if (gbReponseData.code == 1) {
      const message = `${gbReponseData.message}. Đã nhận mã code: "01". Đang chờ via third party trả kết quả về..`;
      const newTransaction = new Transaction({
        userId,
        transId,
        amount,
        bankCode,
        message,
        status: 'PENDING',
      })
      await newTransaction.save()
    }
    console.log('gbReponseData=', gbReponseData)
    return res.status(200).json(gbReponseData)
  } catch (error) {
    console.error('/gb/ibanking/create-payment=', error)
  }
})

router.get('/gb/ibanking/callback', async (req, res) => {
  try {
    console.log('/gb/ibanking/callback was called!');
    const username = req.query.username
    const password = req.query.password
    const amount = req.query.amount
    const transId = req.query.tran_id
    const errorCode = req.query.errorcode
    const message = req.query.messages
    const signature = req.query.signature
  
    console.log('username=', username);
    console.log('password=', password);
    console.log('amount=', amount);
    console.log('transId=', transId);
    console.log('errorCode=', errorCode);
    console.log('message=', message);
    console.log('signature=', signature);
  
    const isVerified = verifyWebhook(username, password, amount, transId, errorCode, message, signature)
  
    if (isVerified) {
      console.log('Webhook verified successfully.')
    } else {
      console.log('Webhook verification failed.')
    }
  
    const transaction = await Transaction.findOne({ transId })
    if (!transaction) {
      // nếu không tìm thấy transaction
      const msg = `Transaction vô dannh. Nhận được callback via third party nhưng không tìm thấy transaction trong db: ${transId}`;
      logger.info(msg)
      const newTransactionDataField = {
        message: `[${new Date().toLocaleString()}] ${msg}. Chấm dứt giao dịch.`,
        status: 'END',
      }
      const anonymousTransaction = new Transaction({
        amount,
        transId,
        bankCode: 'GB_IBANKING',
        message: msg,
        status: 'END',
      })
      await anonymousTransaction.save();
      return res.status(500).send(msg);
    }
  
    // Co transaction trong db
    if(errorCode != 9) {
      logger.info(`Got callback from GB but errorcode is: ${errorCode}`)
      const newTransactionDataField = {
        message: `${transaction.message} -> [${new Date().toLocaleString()}] Máy chủ đã nhận phản hồi third party và tìm thấy mã giao dịch ${transId}. Nhưng giao dịch thất bại do mã lỗi: ${errorCode}.`,
        status: 'END',
      }
      await Transaction.findOneAndUpdate({ transId }, { $set: newTransactionDataField })
      return res.status(500).send(`Nhận được callback nhưng mã lỗi ${errorCode}`);
    }
    
    // Neu errorcode = 0 và tim thay transaction trong db
    const realAmount = Number(amount)
    const realAmountInGame = realAmount / 100;
    const newTransactionDataField = {
      message: `${transaction.message} -> Giao dịch #${transId} thành công. +${realAmountInGame} xu`,
      status: 'END'
    }
    await Transaction.findOneAndUpdate({ transId }, { $set: newTransactionDataField })
    console.log('Hook callback success. Let"s update userData')
    const userId = transaction.userId
  
    const mainPool = getConnectionPool('main')
    const conn = await mainPool.getConnection()
    const updateUserBalanceSqlQuery = 'UPDATE profiles SET balance = balance + ? WHERE users_id = ?';
    const updateUserBalanceResult = await preparedStamentMysqlQuery(conn, updateUserBalanceSqlQuery, [realAmountInGame, userId]);
    conn.release()
    if(!updateUserBalanceResult) {
      logger.error('Internal server error, can update your balance. Please quickly contact Administrator and take a screen shot this page!');
      return res.status(500).send('Internal server error, can update your balance. Please quickly contact Administrator and take a screen shot this page!');
    }
    return res.status(200).send('Transaction success');
  } catch (error) {
    console.error('/gb/ibanking/callback error=', error);
  }
})

router.get('/gb/check/:transId', async (req, res) => {
  const { transId } = req.params;
  console.log('transId=', transId);
  if(!transId) {
    return res.status(500).send('No transaction id params found!');
  }
  let gb_Params = {}
  gb_Params['username'] = process.env.GB_USERNAME
  gb_Params['password'] = process.env.GB_PASSWORD
  gb_Params['tran_id'] = transId
  gb_Params = sortObject(gb_Params)
  let querystring = require('qs')
  let gbCheckUrl = process.env.GB_CHECK_URL;
  gbCheckUrl += '?' + querystring.stringify(gb_Params, { encode: false })

  console.log('gbCheckUrl=', gbCheckUrl);
  const checkResponse = await axios.get(gbCheckUrl);
  const checkResponseData = checkResponse.data;
  return res.json(checkResponseData);
});

router.get('/tst/get-providers', async (req, res) => {
  const tstGetProviderUrl = process.env.TST_GET_PROVIDER_URL
  const response = await axios.get(tstGetProviderUrl)
  return res.json(response.data)
})

router.post('/tst/recharge', async (req, res) => {
  try {
    const { credit_box_email, credit_box_provider, credit_box_value, credit_box_seri, credit_box_pin } = req.body
    const userId = req.session.user.userId
    const APIkey = process.env.TST_APIKEY
    const mathe = credit_box_pin
    const seri = credit_box_seri
    const type = credit_box_provider
    const menhgia = Number(credit_box_value)
    const content = generateRandomString2(32)

    const data = { APIkey, mathe, seri, type, menhgia, content }
    const tstUrl = process.env.TST_URL
    const response = await axios.post(tstUrl, data)
    const responseData = response.data
    if (!responseData) {
      throw new Error('Can"t call api to third party')
    }
    console.log('responseData=', responseData)
    let sweetReponse = {}
    const statusCode = responseData.status.toString()
    switch (statusCode) {
      case '00':
        sweetReponse = {
          title: 'Gửi thẻ thành công',
          text: 'Đang chờ hệ thống xử lý thẻ. Vui lòng đợi',
          icon: 'success',
        }
        const transId = content
        const amount = responseData.amount
        const bankCode = credit_box_provider
        const message = `${responseData.msg}. Đã nhận mã code: "00". Đang chờ via third party trả kết quả về..`
        const status = 'PENDING'
        const newTransaction = new Transaction({ userId, transId, amount, bankCode, message, status })
        await newTransaction.save()
        break
      case '1':
        sweetReponse = {
          title: 'Lỗi',
          text: 'Sai Thông Tin API',
          icon: 'error',
        }
        break
      case '3':
        sweetReponse = {
          title: 'Lỗi',
          text: 'Tài khoản đã bị khóa',
          icon: 'error',
        }
        break
      case '-1089':
        sweetReponse = {
          title: 'Lỗi',
          text: 'Thẻ Đang Bảo Trì',
          icon: 'error',
        }
        break
      case '2':
        sweetReponse = {
          title: 'Lỗi',
          text: 'Thẻ đã được sử dụng trên hệ thống',
          icon: 'error',
        }
        break
      case '56':
        sweetReponse = {
          title: 'Lỗi',
          text: 'Chưa Nhập Seri',
          icon: 'error',
        }
        break
      case '55':
        sweetReponse = {
          title: 'Lỗi',
          text: 'Chưa Nhập Mã Thẻ',
          icon: 'error',
        }
        break
      case '52':
        sweetReponse = {
          title: 'Lỗi',
          text: 'Chưa Chọn Mệnh Giá',
          icon: 'error',
        }
        break
      case '47':
        sweetReponse = {
          title: 'Lỗi',
          text: 'Lỗi không xác định',
          icon: 'error',
        }
        break
      default:
        throw new Error('statusCode was far beyond our understanding')
    }
    return res.json(sweetReponse)
  } catch (error) {
    console.error('/tst/recharge=', error)
    return res.status(500).send(error)
  }
})

router.post('/tst/callback', async (req, res) => {
  try {
    const dataCallback = req.body
    console.log('dataCallback=', dataCallback)
    logger.info(`dataCallback: ${JSON.stringify(dataCallback)}`)
    const transId = dataCallback.content // content of tst response is transaction id
    const transaction = await Transaction.findOne({ transId })
    if (!transaction) {
      // nếu không tìm thấy transaction
      logger.info(`Host receive callback but not found transaction: ${transId}`)
      const newTransactionDataField = {
        message: `${transaction.message} -> [${new Date().toLocaleString()}] Máy chủ đã nhận phản hồi third party nhưng không tìm thấy mã giao dịch ${transId}. Chấm dứt giao dịch.`,
      }
      const updateTransaction = await Transaction.findOneAndUpdate(
        { transId },
        { $set: newTransactionDataField },
        { new: true },
      )
      if (!updateTransaction) {
        logger.error(
          `Can't update failed transactions: ${transId} status to failed because update transaction stament is fail!`,
        )
      }
      return res.status(200).send()
    }
    // Nếu có giao dich ton tai trong system::
    if (dataCallback.status != 'thanhcong') {
      logger.info(`Host receive callback but status is: ${dataCallback.status}`)
      const newTransactionDataField = {
        message: `${transaction.message} -> [${new Date().toLocaleString()}] Máy chủ đã nhận phản hồi third party và tìm thấy mã giao dịch ${transId}. Nhưng giao dịch thất bại do: ${
          dataCallback.status
        }.`,
      }
      await Transaction.findOneAndUpdate({ transId }, { $set: newTransactionDataField })
      return res.status(200).send()
    }
    const realAmount = Number(dataCallback.real_amount)
    const realAmountInGame = realAmount / 100;
    const newTransactionDataField = {
      message: `${transaction.message} -> Giao dịch #${transId} thành công. +${realAmountInGame} xu`,
      status: 'END',
    }
    await Transaction.findOneAndUpdate({ transId }, { $set: newTransactionDataField })
    console.log('Hook callback success. Let"s update userData')
    const userId = transaction.userId

    const mainPool = getConnectionPool('main')
    const conn = await mainPool.getConnection()
    const updateUserBalanceSqlQuery = 'UPDATE profiles SET balance = balance + ? WHERE users_id = ?';
    const updateUserBalanceResult = await preparedStamentMysqlQuery(conn, updateUserBalanceSqlQuery, [realAmountInGame, userId]);
    conn.release()
    if(!updateUserBalanceResult) {
      return res.status(500).send('Internal server error, can update your balance. Please quickly contact Administrator and take a screen shot this page!');
    }
    return res.status(200).send()
  } catch (error) {
    console.error('/tst/callback=', error)
    return res.status(200).send()
  }
})

function sortObject(obj) {
  let sorted = {}
  let str = []
  let key
  for (key in obj) {
    if (obj.hasOwnProperty(key)) {
      str.push(encodeURIComponent(key))
    }
  }
  str.sort()
  for (key = 0; key < str.length; key++) {
    sorted[str[key]] = encodeURIComponent(obj[str[key]]).replace(/%20/g, '+')
  }
  return sorted
}

function generateRandomString(length) {
  const timestamp = new Date().getTime().toString()
  const hash = crypto.createHash('md5').update(timestamp).digest('hex')
  return hash.substring(0, length)
}

function verifyWebhook(username, password, amount, tran_id, errorcode, messages, signature) {
  const str = username + password + amount + tran_id + errorcode + messages

  // Sử dụng thuật toán SHA-256 để tạo chuỗi hash
  const secure = crypto.createHash('sha256').update(str).digest('hex')

  // So sánh chuỗi hash với signature
  return secure === signature
}

module.exports = router
