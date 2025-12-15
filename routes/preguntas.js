const express = require("express");
const router = express.Router();


const { preguntar } = require("../controllers/preguntasController");


router.post("/preguntar", preguntar);

module.exports = router;
