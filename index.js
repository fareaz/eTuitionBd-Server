const express = require('express')
const app = express()
const cors = require("cors")
require("dotenv").config()
const { MongoClient, ServerApiVersion } = require('mongodb');
const port = 3000

app.use(express.json())
app.use(cors())
const uri = `mongodb+srv://${process.env.USER_NAME}:${process.env.USER_PASS}@cluster0.5rsc2du.mongodb.net/?appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


async function run() {
  try {
  
    await client.connect();
    const db =client.db("eTuitionBd")
    const TuitionsCollection = db.collection("tuitions")

   app.get('/tuitions', async (req, res) => {
    const result = await TuitionsCollection.find().toArray();
    res.send(result);
});
app.post('/tuitions', async (req, res) => {
  try {
    const { subject, class: tuitionClass, location, budget, createdAt, createdBy } = req.body

    // basic validation
    if (!subject || !tuitionClass || !location || !budget) {
      return res.status(400).send({ message: 'subject, class, location and budget are required' })
    }

    const tuition = {
      subject: String(subject).trim(),
      class: String(tuitionClass).trim(),
      location: String(location).trim(),
      budget: Number(budget),
      createdAt: createdAt ? new Date(createdAt) : new Date(),
      createdBy: createdBy || null,
    }

    const result = await TuitionsCollection.insertOne(tuition)
    return res.status(201).send({ insertedId: result.insertedId })
  } catch (err) {
    console.error('POST /tuitions error:', err)
    return res.status(500).send({ message: 'Failed to create tuition', error: err.message })
  }
})
  
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
   
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Hello World!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
