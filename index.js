const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = 3000;
const admin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};
const uri = `mongodb+srv://${process.env.USER_NAME}:${process.env.USER_PASS}@cluster0.5rsc2du.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("eTuitionBd");
    const TuitionsCollection = db.collection("tuitions");
    const UsersCollection = db.collection("users");
    const TutorCollection = db.collection("tutor");

    app.get("/tutors", async (req, res) => {
      const result = await TutorCollection.find()
        .sort({ createdAt: -1 }) // -1 = newest first
        .toArray();

      res.send(result);
    });

    app.get("/my-tutors", async (req, res) => {
      const { email } = req.query;

      const items = await TutorCollection.find({
        email: String(email).toLowerCase().trim(),
      })
        .sort({ createdAt: -1 })
        .toArray();
      return res.send(items);
    });

    app.patch("/tutors/:id", async (req, res) => {
      const { id } = req.params;
      const payload = req.body;
      const updateDoc = {
        $set: {
          name: payload.name,
          qualifications: payload.qualifications,
          experience: payload.experience,
          expectedSalary: payload.expectedSalary,
          updatedAt: new Date().toISOString(),
        },
      };

      const result = await TutorCollection.updateOne(
        { _id: new ObjectId(id) },
        updateDoc
      );
      return res.json(result);
    });

    app.delete("/tutors/:id", async (req, res) => {
      const { id } = req.params;
      const { ObjectId } = require("mongodb");
      const result = await TutorCollection.deleteOne({ _id: new ObjectId(id) });
      return res.json(result);
    });

    app.get("/approved-tutors", async (req, res) => {
      const result = await TutorCollection.find({
        status: "Approved",
      })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.patch("/tutors/:id/status", verifyFBToken, async (req, res) => {
      const idParam = req.params.id;
      const status = req.body.status;
      const filter = {};
      try {
        filter._id = new ObjectId(idParam);
      } catch (err) {
        filter._id = idParam;
      }

      const update = {
        $set: {
          status: String(status).trim(),
        },
      };

      const result = await TutorCollection.updateOne(filter, update);
      res.send(result);
    });

    app.delete("/tutors/:id", verifyFBToken, async (req, res) => {
      const idParam = req.params.id;
      let filter = {};
      try {
        filter._id = new ObjectId(idParam);
      } catch (err) {
        filter._id = idParam;
      }

      const result = await TutorCollection.deleteOne(filter);
      res.send(result);
    });

    app.post("/tutors", async (req, res) => {
      const data = req.body;
      const result = await TutorCollection.insertOne(data);
      return res.send(result);
    });
   app.get("/users/admin", async (req, res) => {
  const adminUser = await UsersCollection.findOne({ email: "admin@gmail.com" });
  res.send(adminUser);
});

    app.post("/users", async (req, res) => {
      const { email, name = "", phone = "", role = "Student" } = req.body;

      const normalizedEmail = String(email).toLowerCase().trim();
      const now = new Date();

      const result = await UsersCollection.updateOne(
        { email: normalizedEmail },
        {
          $set: {
            name: String(name).trim(),
            phone: String(phone).trim(),
            role: String(role).trim(),
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true }
      );

      return res.send(result);
    });

    app.get("/users", async (req, res) => {
      const searchText = req.query.searchText;
      const query = {};

      if (searchText) {
        const regex = { $regex: searchText, $options: "i" };
        query.$or = [{ displayName: regex }, { email: regex }];
      }

      const cursor = UsersCollection.find(query)
        .sort({ createdAt: -1 })
        .limit(50);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const user = await UsersCollection.findOne({ email });
      res.send({ role: user?.role || "student" });
    });
    app.patch("/users/:id/role", async (req, res) => {
      const id = req.params.id;

      const roleInfo = req.body;

      const query = { _id: new ObjectId(id) };

      const updatedDoc = {
        $set: {
          role: roleInfo.role,
        },
      };
      const result = await UsersCollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.patch("/users/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const requesterEmail = String(req.decoded_email || "")
        .toLowerCase()
        .trim();
      const requester = await UsersCollection.findOne({
        email: requesterEmail,
      });
      const requesterRole = String(requester.role || "")
        .toLowerCase()
        .trim();
      if (requesterRole !== "admin") {
        return res.status(403).send({ message: "Forbidden: admin only" });
      }
      let filter;
      try {
        filter = { _id: new ObjectId(id) };
      } catch (err) {
        filter = { _id: id };
      }

      const { email, name, phone, role } = req.body;
      const updateFields = {};

      if (typeof email === "string" && email.trim() !== "")
        updateFields.email = String(email).toLowerCase().trim();
      if (typeof name === "string" && name.trim() !== "")
        updateFields.name = String(name).trim();
      if (typeof phone === "string") updateFields.phone = String(phone).trim();
      if (typeof role === "string" && role.trim() !== "")
        updateFields.role = String(role).trim();

      if (Object.keys(updateFields).length === 0) {
        return res.status(400).send({ message: "No valid fields to update" });
      }

      updateFields.updatedAt = new Date();

      const result = await UsersCollection.updateOne(filter, {
        $set: updateFields,
      });
      return res.send(result);
    });

    app.delete("/users/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const _id = new ObjectId(id);

      const result = await UsersCollection.deleteOne({ _id });

      res.send(result);
    });

    app.get("/my-tuitions", async (req, res) => {
      const email = req.query.email;
      const normalized = String(email).toLowerCase().trim();
      const result = await TuitionsCollection.find({
        createdBy: normalized,
      }).toArray();
      res.send(result);
    });

  app.get("/approved-tuitions", async (req, res) => {
  
    const {
      page = 1,
      limit = 10,
      search = "",
      sort = "newest",
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    
    const searchFilter = search
      ? {
          $or: [
            { subject: { $regex: search, $options: "i" } },
            { location: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    const baseFilter = { status: "Approved", ...searchFilter };

  
    let sortCondition = {};
    if (sort === "newest") sortCondition = { createdAt: -1 };
    if (sort === "oldest") sortCondition = { createdAt: 1 };
    if (sort === "budget-asc") sortCondition = { budget: 1 };
    if (sort === "budget-desc") sortCondition = { budget: -1 };

  
    const total = await TuitionsCollection.countDocuments(baseFilter);

  
    const results = await TuitionsCollection.find(baseFilter)
      .sort(sortCondition)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .toArray();

    res.send({
      total,
      page: pageNum,
      limit: limitNum,
      results,
    });
  
});


    app.patch("/tuitions/:id/status", async (req, res) => {
      const idParam = req.params.id;
      const status = req.body.status;

      const filter = {};
      try {
        filter._id = new ObjectId(idParam);
      } catch (err) {
        filter._id = idParam;
      }

      const update = {
        $set: {
          status: String(status).trim(),
        },
      };
      const result = await TuitionsCollection.updateOne(filter, update);
      return res.send(result);
    });

    app.delete("/tuitions/:id", async (req, res) => {
      console.log(req.params.id);
      const id = req.params.id;
      const _id = new ObjectId(id);
      console.log(_id);
      const result = await TuitionsCollection.deleteOne({ _id });

      res.send(result);
    });

    app.get("/tuitions", async (req, res) => {
      const result = await TuitionsCollection.find()
        .sort({ createdAt: -1 })
        .toArray();

      res.send(result);
    });

    app.patch("/tuitions/:id", async (req, res) => {
      const id = req.params.id;
      const _id = new ObjectId(id);
      const { subject, class: tuitionClass, location, budget } = req.body;

      const updateFields = {};
      if (subject !== undefined) updateFields.subject = String(subject).trim();
      if (tuitionClass !== undefined)
        updateFields.class = String(tuitionClass).trim();
      if (location !== undefined)
        updateFields.location = String(location).trim();
      if (budget !== undefined) updateFields.budget = Number(budget);

      updateFields.updatedAt = new Date();

      const result = await TuitionsCollection.updateOne(
        { _id },
        { $set: updateFields }
      );
      return res.send({ success: true, result });
    });

    app.post("/tuitions", async (req, res) => {
      const {
        subject,
        class: tuitionClass,
        location,
        budget,
        createdBy,
      } = req.body;

      const tuition = {
        subject: String(subject).trim(),
        class: String(tuitionClass).trim(),
        location: String(location).trim(),
        budget: Number(budget),
        createdAt: new Date(),
        status: "pending",
        createdBy: createdBy || null,
      };

      const result = await TuitionsCollection.insertOne(tuition);
      return res.status(201).json({ insertedId: result.insertedId });
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
