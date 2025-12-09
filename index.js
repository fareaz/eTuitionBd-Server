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
    const ApplicationsCollection = db.collection("applications");

    app.post("/applications", verifyFBToken, async (req, res) => {
      const tutorEmail = req.decoded_email;
      const { tuitionId } = req.body;
      let tuitionDoc;
      try {
        tuitionDoc = await TuitionsCollection.findOne({
          _id: new ObjectId(tuitionId),
        });
      } catch {
        return res.status(400).send({ message: "Invalid tuitionId" });
      }

      const tutorDoc = await TutorCollection.findOne({ email: tutorEmail });

      const already = await ApplicationsCollection.findOne({
        tuitionId: tuitionDoc._id,
        tutorEmail,
      });
      if (already) {
        return res
          .status(409)
          .send({ message: "You already applied to this tuition" });
      }

      // 4) Build final application document
      const application = {
        tuitionId: tuitionDoc._id,

        // Tuition info
        studentName:tuitionDoc.name,
        subject: tuitionDoc.subject,
        class: tuitionDoc.class,
        location: tuitionDoc.location,
        budget: tuitionDoc.budget,

        // Tutor info
        tutorEmail,
        tutorName: tutorDoc.name,
        tutorQualifications: tutorDoc.qualifications,
        tutorExperience: tutorDoc.experience,
        expectedSalary: tutorDoc.expectedSalary,

        // Student info
        studentEmail: tuitionDoc.createdBy || "",

        status: "pending",
        createdAt: new Date(),
      };

      const result = await ApplicationsCollection.insertOne(application);
      res.status(201).send({ insertedId: result.insertedId, application });
    });

    app.get("/applications",async (req, res) => {
        const { tutorEmail, studentEmail, tuitionId } = req.query;
        const q = {};
        if (tutorEmail) q.tutorEmail = String(tutorEmail).toLowerCase().trim();
        if (studentEmail)
          q.studentEmail = String(studentEmail).toLowerCase().trim();
        if (tuitionId) {
          try {
            q.tuitionId = new ObjectId(tuitionId);
          } catch {
            return res.status(400).json({ message: "Invalid tuitionId" });
          }
        }
        const items = await ApplicationsCollection.find(q)
          .sort({ createdAt: -1 })
          .toArray();
        res.send(items);
      });

    // // PATCH /applications/:id/status -> update status (admin or student maybe)
    // app.patch(
    //   "/applications/:id/status",
    //   verifyFBToken,
    //   isAdmin(UsersCollection), // or change middleware logic to allow student to accept/reject
    //   wrapAsync(async (req, res) => {
    //     const id = parseObjectIdOrThrow(req.params.id);
    //     const { status } = req.body;
    //     if (!status)
    //       return res.status(400).json({ message: "status is required" });
    //     const result = await ApplicationsCollection.updateOne(
    //       { _id: id },
    //       { $set: { status: String(status).trim(), updatedAt: new Date() } }
    //     );
    //     res.json(result);
    //   })
    // );

    // // Optional: tutor can cancel their application
    // app.delete(
    //   "/applications/:id",
    //   verifyFBToken,
    //   wrapAsync(async (req, res) => {
    //     const id = parseObjectIdOrThrow(req.params.id);
    //     const tutorEmail = req.decoded_email;
    //     const appDoc = await ApplicationsCollection.findOne({ _id: id });
    //     if (!appDoc)
    //       return res.status(404).json({ message: "Application not found" });
    //     // only owner tutor or admin can delete
    //     const requester = await UsersCollection.findOne({ email: tutorEmail });
    //     const isRequesterAdmin =
    //       String(requester?.role || "").toLowerCase() === "admin";
    //     if (!isRequesterAdmin && appDoc.tutorEmail !== tutorEmail) {
    //       return res.status(403).json({ message: "Forbidden" });
    //     }
    //     const result = await ApplicationsCollection.deleteOne({ _id: id });
    //     res.json(result);
    //   })
    // );
    /* ---------------------------
  Applications: PATCH / DELETE / PAY routes
  Paste inside your run() after ApplicationsCollection is defined
---------------------------- */

    // PATCH /applications/:id  -> update status or paid (only student-owner or admin)
    app.patch("/applications/:id", verifyFBToken, async (req, res) => {
      try {
        const idParam = req.params.id;
        let filter;
        try {
          filter = { _id: new ObjectId(idParam) };
        } catch (err) {
          return res.status(400).send({ message: "Invalid application id" });
        }

        const appDoc = await ApplicationsCollection.findOne(filter);
        if (!appDoc) return res.status(404).send({ message: "Application not found" });

        // requester info from token
        const requesterEmail = String(req.decoded_email || "").toLowerCase().trim();
        const requester = await UsersCollection.findOne({ email: requesterEmail });
        const requesterRole = String(requester?.role || "").toLowerCase().trim();

        // who can change status: student-owner (who posted tuition) or admin
        const isStudentOwner = appDoc.studentEmail && appDoc.studentEmail.toLowerCase().trim() === requesterEmail;
        const isAdmin = requesterRole === "admin";

        if (!isStudentOwner && !isAdmin) {
          return res.status(403).send({ message: "Forbidden: only student-owner or admin can update status" });
        }

        const { status, paid } = req.body;
        const updateFields = {};
        if (typeof status === "string") updateFields.status = String(status).trim();
        if (typeof paid !== "undefined") updateFields.paid = !!paid;
        if (Object.keys(updateFields).length === 0) {
          return res.status(400).send({ message: "No valid fields to update" });
        }
        updateFields.updatedAt = new Date();

        const result = await ApplicationsCollection.updateOne(filter, { $set: updateFields });

        // If status changed to 'approved', optionally reject other pending apps for same tuition
        if (updateFields.status === "approved") {
          try {
            await ApplicationsCollection.updateMany(
              {
                tuitionId: appDoc.tuitionId,
                _id: { $ne: appDoc._id },
                status: { $in: ["pending", "requested"] },
              },
              { $set: { status: "rejected", updatedAt: new Date() } }
            );
          } catch (e) {
            console.error("Failed to auto-reject other applications:", e);
          }
        }

        return res.send(result);
      } catch (err) {
        console.error("PATCH /applications/:id error:", err);
        return res.status(500).send({ message: "Server error" });
      }
    });

    // PATCH /applications/:id/pay -> mark as paid & approved (student-owner or admin)
    app.patch("/applications/:id/pay", verifyFBToken, async (req, res) => {
      try {
        const idParam = req.params.id;
        let filter;
        try {
          filter = { _id: new ObjectId(idParam) };
        } catch (err) {
          return res.status(400).send({ message: "Invalid application id" });
        }

        const appDoc = await ApplicationsCollection.findOne(filter);
        if (!appDoc) return res.status(404).send({ message: "Application not found" });

        const requesterEmail = String(req.decoded_email || "").toLowerCase().trim();
        const requester = await UsersCollection.findOne({ email: requesterEmail });
        const requesterRole = String(requester?.role || "").toLowerCase().trim();

        const isStudentOwner = appDoc.studentEmail && appDoc.studentEmail.toLowerCase().trim() === requesterEmail;
        const isAdmin = requesterRole === "admin";

        if (!isStudentOwner && !isAdmin) {
          return res.status(403).send({ message: "Forbidden: only student-owner or admin can mark paid" });
        }

        const updateFields = { paid: true, status: "approved", updatedAt: new Date() };
        const result = await ApplicationsCollection.updateOne(filter, { $set: updateFields });

        // reject other pending applications for same tuition
        try {
          await ApplicationsCollection.updateMany(
            {
              tuitionId: appDoc.tuitionId,
              _id: { $ne: appDoc._id },
              status: { $in: ["pending", "requested"] },
            },
            { $set: { status: "rejected", updatedAt: new Date() } }
          );
        } catch (e) {
          console.error("Failed to auto-reject other applications after pay:", e);
        }

        return res.send(result);
      } catch (err) {
        console.error("PATCH /applications/:id/pay error:", err);
        return res.status(500).send({ message: "Server error" });
      }
    });

    // DELETE /applications/:id -> delete (student-owner OR tutor-owner OR admin)
    app.delete("/applications/:id", verifyFBToken, async (req, res) => {
      try {
        const idParam = req.params.id;
        let filter;
        try {
          filter = { _id: new ObjectId(idParam) };
        } catch (err) {
          return res.status(400).send({ message: "Invalid application id" });
        }

        const appDoc = await ApplicationsCollection.findOne(filter);
        if (!appDoc) return res.status(404).send({ message: "Application not found" });

        const requesterEmail = String(req.decoded_email || "").toLowerCase().trim();
        const requester = await UsersCollection.findOne({ email: requesterEmail });
        const requesterRole = String(requester?.role || "").toLowerCase().trim();

        const isAdmin = requesterRole === "admin";
        const isStudentOwner = appDoc.studentEmail && appDoc.studentEmail.toLowerCase().trim() === requesterEmail;
        const isTutorOwner = appDoc.tutorEmail && appDoc.tutorEmail.toLowerCase().trim() === requesterEmail;

        if (!isAdmin && !isStudentOwner && !isTutorOwner) {
          return res.status(403).send({ message: "Forbidden: only related users or admin can delete" });
        }

        const result = await ApplicationsCollection.deleteOne(filter);
        return res.send(result);
      } catch (err) {
        console.error("DELETE /applications/:id error:", err);
        return res.status(500).send({ message: "Server error" });
      }
    });




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
      const adminUser = await UsersCollection.findOne({
        email: "admin@gmail.com",
      });
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
  
    app.patch("/users/update/:id", verifyFBToken, async (req, res) => {
  const id = req.params.id;
  const requesterEmail = String(req.decoded_email || "")
    .toLowerCase()
    .trim();
  const requester = await UsersCollection.findOne({ email: requesterEmail });

  const { name, phone } = req.body;

  const updateFields = {};
  if (typeof name === "string") updateFields.name = name.trim();
  if (typeof phone === "string") updateFields.phone = phone.trim();

 
  updateFields.updatedAt = new Date();

  const filter = { _id: new ObjectId(id) };

  const result = await UsersCollection.updateOne(filter, { $set: updateFields });

  res.send(result);
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
      const { page = 1, limit = 10, search = "", sort = "newest" } = req.query;

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
