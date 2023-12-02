const { default: axios } = require('axios');
const express = require('express');
const router = express.Router();
const moment = require('moment');

router.post('/ibanking/create_payment_url', async (req, res) => {
    /**
     * req= [Object: null prototype] {
        ibanking_value: '10000',
        ibanking_bankcode: ''
      }
     */
    if(!req.body.ibanking_value) {
        return res.status(500).send('Đấy là bug chăng?');
    }
    let date = new Date();
    let createDate = moment(date).format('YYYYMMDDHHmmss');
    let ipAddr = req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress;
    
    // Set params for url
    let tmnCode = process.env.VNP_TMNCODE;
    let secretKey = process.env.VNP_TMNCODE;
    let vnpUrl = process.env.VNP_URL;
    let returnUrl = process.env.VNP_RETURNURL;
    let orderId = moment(date).format('DDHHmmss');
    let amount = req.body.ibanking_value;
    let bankCode = req.body.ibanking_bankcode;
    let locale = 'vn';
    let currCode = 'VND';
    let vnp_Params = {};

    vnp_Params['vnp_Version'] = '2.1.0';
    vnp_Params['vnp_Command'] = 'pay';
    vnp_Params['vnp_TmnCode'] = tmnCode;
    vnp_Params['vnp_Locale'] = locale;
    vnp_Params['vnp_CurrCode'] = currCode;
    vnp_Params['vnp_TxnRef'] = orderId;
    vnp_Params['vnp_OrderInfo'] = 'Thanh toan nap tien ibanking cho ma GD:' + orderId;
    vnp_Params['vnp_OrderType'] = 'other';
    vnp_Params['vnp_Amount'] = amount * 100;
    vnp_Params['vnp_ReturnUrl'] = returnUrl;
    vnp_Params['vnp_IpAddr'] = ipAddr;
    vnp_Params['vnp_CreateDate'] = createDate;
    if(bankCode !== null && bankCode !== ''){
        vnp_Params['vnp_BankCode'] = bankCode;
    }

    vnp_Params = sortObject(vnp_Params);
    console.log('vnp_Params=',vnp_Params);

    let querystring = require('qs');
    let signData = querystring.stringify(vnp_Params, { encode: false });
    let crypto = require("crypto");
    let hmac = crypto.createHmac("sha512", secretKey);
    let signed = hmac.update(new Buffer(signData, 'utf-8')).digest("hex");
    vnp_Params['vnp_SecureHash'] = signed;
    vnpUrl += '?' + querystring.stringify(vnp_Params, { encode: false });

    return res.redirect(vnpUrl);
});

router.get('/get-vnp-banks', async (req, res) => {
    try {
        const formData = {
            tmn_code: process.env.VNP_TMNCODE
        }
        const response = await axios.post('https://sandbox.vnpayment.vn/qrpayauth/api/merchant/get_bank_list', formData, {headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        }});
        const banklist = response.data;
        if(banklist) {
            return res.json(banklist);
        }
        return res.json([]);
    } catch (error) {
        console.error(error.message);
    }
});

function sortObject(obj) {
	let sorted = {};
	let str = [];
	let key;
	for (key in obj){
		if (obj.hasOwnProperty(key)) {
		str.push(encodeURIComponent(key));
		}
	}
	str.sort();
    for (key = 0; key < str.length; key++) {
        sorted[str[key]] = encodeURIComponent(obj[str[key]]).replace(/%20/g, "+");
    }
    return sorted;
}

module.exports = router;