const express = require('express');
const app = express();
const port = 3000;

app.use(express.json());
app.get('/add', (req, res) => {
    const num1 = req.query.num1;
    const num2 = req.query.num2;
    const result = parseFloat(num1) + parseFloat(num2);
    res.send(`The sum is ${result}`);
});

app.get('/subtract', (req, res) => {
    const num1 = req.query.num1;
    const num2 = req.query.num2;
    const result = parseFloat(num1) - parseFloat(num2);
    res.send(`The difference is ${result}`);
});

app.get('/multiply', (req, res) => {
    const num1 = req.query.num1;
    const num2 = req.query.num2;
    const result = parseFloat(num1) * parseFloat(num2);
    res.send(`The product is ${result}`);
});

app.get('/divide', (req, res) => {
    const num1 = req.query.num1;
    const num2 = req.query.num2;
    if (num2 === 0) {
        return res.status(400).send('Cannot divide by zero');
    }
    const result = parseFloat(num1) / parseFloat(num2);
    res.send(`The quotient is ${result}`);
});

app.listen(port, () => {
    console.log(`Server started on port ${port}`);
});