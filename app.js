const express = require('express');
const app = express();
const port = 3000;

app.use(express.json());
app.get('/add', (req, res) => {
    const { num1, num2 } = req.body;
    const result = num1 + num2;
    res.json({ result });
});
app.get('/subtract', (req, res) => {
    const { num1, num2 } = req.body;
    const result = num1 - num2;
    res.json({ result });
});
app.get('/multiply', (req, res) => {
    const { num1, num2 } = req.body;
    const result = num1 * num2;
    res.json({ result });
});
app.get('/divide', (req, res) => {
    const { num1, num2 } = req.body;
    if(num2 === 0) return res.status(400).json({ error: 'Cannot divide by zero' });
    const result = num1 / num2;
    res.json({ result });
});
app.use((req, res) => {
    res.status(404).json({ message: 'Not found' });
});
app.listen(port, () => {
    console.log(`Server started on port ${port}`);
});