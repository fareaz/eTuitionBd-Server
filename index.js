const express = require('express')
const app = express()
const cors = require("cors")
require("dotenv").config()
const { MongoClient, ServerApiVersion } = require('mongodb');
const port = 3000

app.use(express.json())
app.use(cors())
const uri = `mongodb+srv://${process.env.USER_NAME}:${process.env.USER_PASS}@cluster0.5rsc2du.mongodb.net/?appName=Cluster0`;

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
    const UsersCollection = db.collection('users');
    const TutorCollection =db.collection('tutor')

    
// add inside run()
// paste inside your run() after: const TutorCollection = db.collection('tutor')
app.post('/tutors', async (req, res) => {
  const data = req.body
  const result =await TutorCollection.insertOne(data) 
  return  res.send( result)
 
});

app.post('/users', async (req, res) => {
  const { email, name = '', phone = '', role = 'Student' } = req.body;

  const normalizedEmail = String(email).toLowerCase().trim();
  const now = new Date();

  const result = await UsersCollection.updateOne(
    { email: normalizedEmail },
    {
      $set: {
        name: String(name).trim(),
        phone: String(phone).trim(),
        role: String(role).trim(),
        updatedAt: now    // <-- ONLY this line added
      },
      $setOnInsert: {
        createdAt: now
      }
    },
    { upsert: true }
  );

  return res.send(result);
});


   app.get('/tuitions', async (req, res) => {
    const result = await TuitionsCollection.find().toArray();
    res.send(result);
});
app.post('/tuitions', async (req, res) => {
  
    const { subject, class: tuitionClass, location, budget, createdBy } = req.body

    const tuition = {
      subject: String(subject).trim(),
      class: String(tuitionClass).trim(),
      location: String(location).trim(),
      budget: Number(budget),
      createdAt: new Date(),
      createdBy: createdBy || null,
    }
   
    const result = await TuitionsCollection.insertOne(tuition)
    return res.send( result)
 
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
