const express = require('express')
const app = express()
const cors = require("cors")
require("dotenv").config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = 3000
const admin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
app.use(express.json())
app.use(cors())

const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
    }

    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        console.log('decoded in the token', decoded);
        req.decoded_email = decoded.email;
        next();
    }
    catch (err) {
        return res.status(401).send({ message: 'unauthorized access' })
    }


  }
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

app.post('/users', verifyFBToken, async (req, res) => {
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
// GET /users?searchText=...  (already had verifyFBToken middleware in your sample)
app.get('/users',async (req, res) => {

    const searchText = req.query.searchText;
    const query = {};

    if (searchText) {
      const regex = { $regex: searchText, $options: 'i' };
      query.$or = [
        { displayName: regex },
        { email: regex }
      ];
    }

    const cursor = UsersCollection.find(query).sort({ createdAt: -1 }).limit(50); 
    const result = await cursor.toArray();
    res.send(result);
 
});
// // PATCH /users/:id/role
// app.patch('/users/:id/role', verifyFBToken, async (req, res) => {
//   try {
//     const id = req.params.id;
//     if (!id) return res.status(400).send({ message: 'id required' });

//     // Optional: only admin should change roles — you can verify here using req.user from verifyFBToken
//     // if (!req.user || req.user.role !== 'admin') return res.status(403).send({ message: 'Forbidden' });

//     const { role } = req.body;
//     if (!role) return res.status(400).send({ message: 'role required' });

//     const normalizedRole = String(role).trim();

//     const filter = { _id: new ObjectId(id) };
//     const update = {
//       $set: {
//         role: normalizedRole,
//         updatedAt: new Date()
//       }
//     };

//     const result = await UsersCollection.updateOne(filter, update);
//     res.send(result); // contains modifiedCount
//   } catch (err) {
//     console.error('PATCH /users/:id/role error', err);
//     res.status(500).send({ message: 'Server error' });
//   }
// });

 app.get('/users/:email/role', async (req, res) => {
  const email = req.params.email;
  const user = await UsersCollection.findOne({ email });
  res.send({ role: user?.role || 'student' });
});
  app.patch('/users/:id/role', async (req, res) => {
   
     const id = req.params.id;
           
            const roleInfo = req.body;
           
            const query = { _id: new ObjectId(id) }
            
            
            const updatedDoc = {
                $set: {
                    role: roleInfo.role
                }
            }
            const result = await UsersCollection.updateOne(query, updatedDoc)
            res.send(result);
        })

app.get('/my-tuitions', async (req, res) => {
 
    const email = req.query.email;
    const normalized = String(email).toLowerCase().trim();
    const result = await TuitionsCollection.find({ createdBy: normalized }).toArray();
    res.send(result);
 
});


app.delete('/tuitions/:id', async (req, res) => {

    console.log(req.params.id)
    const id = req.params.id;
    const _id = new ObjectId(id);
    console.log(_id)
    const result = await TuitionsCollection.deleteOne({ _id });
    
    res.send(result);
 
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
