var express = require('express')
var bodyParser = require('body-parser')
const { Pool } = require('pg')

const pool = new Pool({
    
    user: 'dbuser', //add suppression here to test
    host: 'database.server.com',
    database: 'mydb',
    password: process.env.POSTGRES_PASSWORD,
    port: 3211,
})

var app = express()
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({
    extended: true
}));


app.get("/", function(req, res){
    const search = req.params.q

    if (search != "") {
        var squery = "SELECT * FROM users WHERE name = \"" + search + "\""
        pool.query(squery, (err, res) => {
            console.log(err, res)
            pool.end()
        })
    }
})
app.post("/records", (request, response) => {
	const data = request.body;
	const query = `SELECT * FROM records WHERE id = (${data.id})`;
	connection.query(query, (err, rows) => {
	  if(err) throw err;
	  response.json({data:rows});
	});
      });
app.listen(8000, function () {
    console.log("Server running");
});
