const passport = require('passport');
const express = require('express');
const https = require('https');
const socketIO = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const session = require('express-session');
require('./middleware');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const bycrypt = require('bcryptjs');

const pool = new Pool({
    user: "taiproduaxe",
    host: "dpg-cjt898h5mpss738mq070-a.singapore-postgres.render.com",
    database: "datdundinh",
    password: "X3K8bx6Xa9Fx3CK9IbT1jiVJ5ls3h9tZ",
    port: 5432,
    ssl: true,
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Lỗi khi kết nối đến PostgreSQL:', err);
    } else {
        console.log('Kết nối thành công vào PostgreSQL, thời gian hiện tại:', res.rows[0].now);
    }
});

// App settings
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());
app.use(session({
  secret: 'concavang',
  resave: false,
  saveUninitialized: true,
  cookie: {secure: false},
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cookieParser('concavang'));
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

// Certificates
const options = {
    key: fs.readFileSync('./certificates/erukascholar.live/key.pem'),
    cert: fs.readFileSync('./certificates/erukascholar.live/certificate.crt'),
}
const server = https.createServer(options, app);
const io = socketIO(server);

// Rountings
app.get('/', (req, res) => {
    return res.render('index');
});

// Khởi động server
const port = process.env.PORT;
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});