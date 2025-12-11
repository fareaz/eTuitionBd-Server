const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = 3000;
const admin = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

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
    const paymentsCollection = db.collection("payments");

    const verifyADMIN = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await UsersCollection.findOne({ email });
      if (user?.role !== "admin")
        return res
          .status(403)
          .send({ message: "Admin only Actions!", role: user?.role });

      next();
    };
    const verifyTutor = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await UsersCollection.findOne({ email });
      console.log(email);
      if (user?.role !== "Tutor")
        return res
          .status(403)
          .send({ message: "tutor only Actions!", role: user?.role });
      next();
    };

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      // console.log(paymentInfo);
      const amount = parseInt(paymentInfo.cost) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: {
                name: `Please pay for: ${paymentInfo.tutorEmail}`,
              },
            },

            quantity: 1,
          },
        ],
        customer_email: paymentInfo.studentEmail,
        mode: "payment",
        metadata: {
          paymentId: paymentInfo.paymentId,
          tutorEmail: paymentInfo.tutorEmail,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;

      const session = await stripe.checkout.sessions.retrieve(sessionId);

      const transactionId = session.payment_intent;

      const txnQuery = { transactionId };
      const paymentExist = await paymentsCollection.findOne(txnQuery);
      if (paymentExist) {
        return res.send({
          success: true,
          message: "already exists",
          transactionId,
          existingId: paymentExist._id,
        });
      }

      if (session.payment_status !== "paid") {
        return res
          .status(400)
          .send({ success: false, message: "Payment not paid" });
      }

      const appId = session.metadata.paymentId;

      const appQuery = { _id: new ObjectId(appId) };

      const update = {
        $set: {
          status: "paid",
          updatedAt: new Date(),
        },
      };

      const result = await ApplicationsCollection.updateOne(appQuery, update);

      const payment = {
        amount: session.amount_total / 100,
        currency: session.currency,
        studentEmail: session.customer_email,
        tutorEmail: session.metadata.tutorEmail,
        paymentId: session.metadata.paymentId,
        transactionId: session.payment_intent,
        paymentStatus: session.payment_status,
        paidAt: new Date(),
      };

      const filter = { transactionId: payment.transactionId };
      const upsertRes = await paymentsCollection.updateOne(
        filter,
        { $setOnInsert: payment },
        { upsert: true }
      );

      let resultPayment = null;
      if (upsertRes.upsertedCount === 1) {
        resultPayment = {
          acknowledged: true,
          upsertedId: upsertRes.upsertedId,
          message: "inserted",
        };
      } else {
        const existing = await paymentsCollection.findOne(filter);
        resultPayment = {
          acknowledged: false,
          message: "Already exists",
          existingId: existing ? existing._id : null,
        };
      }

      return res.send({
        success: true,
        message: "Payment processed",
        transactionId: session.payment_intent,
        appUpdate: result,
        paymentResult: resultPayment,
      });
    });

    app.get("/payments", async (req, res) => {
      const email = req.query.email;
      const payments = await paymentsCollection
        .find({ studentEmail: String(email).toLowerCase() })
        .sort({ paidAt: -1 })
        .toArray();

      return res.send({ success: true, data: payments });
    });

    app.get("/tutor-revenue", async (req, res) => {
      const email = req.query.email;
      const payments = await paymentsCollection
        .find({ tutorEmail: String(email).toLowerCase() })
        .sort({ paidAt: -1 })
        .toArray();
      return res.send({ success: true, data: payments });
    });

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

    
      // console.log(tuitionDoc);
      const application = {
        tuitionId: tuitionDoc._id,

        // Tuition info
        studentName: tuitionDoc.name,
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

    app.get("/applications", verifyFBToken, async (req, res) => {
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
      const result = await ApplicationsCollection.find(q)
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.patch("/applications/:id", verifyFBToken, async (req, res) => {
     
        const idParam = req.params.id;
        let filter;
        try {
          filter = { _id: new ObjectId(idParam) };
        } catch (err) {
          return res.status(400).send({ message: "Invalid application id" });
        }

        const appDoc = await ApplicationsCollection.findOne(filter);
        if (!appDoc)
          return res.status(404).send({ message: "Application not found" });

        // requester info from token (verifyFBToken sets req.decoded_email)
        const requesterEmail = String(req.decoded_email || "")
          .toLowerCase()
          .trim();
        if (!requesterEmail) {
          return res
            .status(401)
            .send({ message: "Unauthorized: missing token email" });
        }

        const requester = await UsersCollection.findOne({
          email: requesterEmail,
        });
        const requesterRole = String(requester?.role || "")
          .toLowerCase()
          .trim();

        // ownership flags
        const isStudentOwner =
          appDoc.studentEmail &&
          appDoc.studentEmail.toLowerCase().trim() === requesterEmail;
        const isAdmin = requesterRole === "admin";
        const isTutorOwner =
          appDoc.tutorEmail &&
          appDoc.tutorEmail.toLowerCase().trim() === requesterEmail;

        const { status, paid } = req.body;

        // If requester is not authorized in general, reject early
        if (!isAdmin && !isStudentOwner && !isTutorOwner) {
          return res.status(403).send({
            message:
              "Forbidden: only related users or admin can update this application",
          });
        }

       
        if (isTutorOwner && !isAdmin && !isStudentOwner) {
        
          if (typeof status === "string") {
            if (String(status).toLowerCase() !== "confirmed") {
              return res.status(403).send({
                message:
                  "Forbidden: tutor can only mark application as 'confirmed'",
              });
            }
          } else {
            // If tutor tries to update other fields (like paid) deny
            return res.status(403).send({
              message: "Forbidden: tutor not allowed to update these fields",
            });
          }
        }

        // Build update
        const updateFields = {};
        if (typeof status === "string")
          updateFields.status = String(status).trim();
        if (typeof paid !== "undefined") updateFields.paid = !!paid;

        if (Object.keys(updateFields).length === 0) {
          return res.status(400).send({ message: "No valid fields to update" });
        }

        updateFields.updatedAt = new Date();

        const result = await ApplicationsCollection.updateOne(filter, {
          $set: updateFields,
        });

     
        if (
          updateFields.status &&
          String(updateFields.status).toLowerCase() === "approved"
        ) {
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
      
    });

    app.patch("/applications/:id/pay", verifyFBToken, async (req, res) => {
     
        const idParam = req.params.id;
        let filter;
        try {
          filter = { _id: new ObjectId(idParam) };
        } catch (err) {
          return res.status(400).send({ message: "Invalid application id" });
        }

        const appDoc = await ApplicationsCollection.findOne(filter);
        if (!appDoc)
          return res.status(404).send({ message: "Application not found" });

        const requesterEmail = String(req.decoded_email || "")
          .toLowerCase()
          .trim();
        const requester = await UsersCollection.findOne({
          email: requesterEmail,
        });
        const requesterRole = String(requester?.role || "")
          .toLowerCase()
          .trim();

        const isStudentOwner =
          appDoc.studentEmail &&
          appDoc.studentEmail.toLowerCase().trim() === requesterEmail;
        const isAdmin = requesterRole === "admin";

        if (!isStudentOwner && !isAdmin) {
          return res.status(403).send({
            message: "Forbidden: only student-owner or admin can mark paid",
          });
        }

        const updateFields = {
          paid: true,
          status: "approved",
          updatedAt: new Date(),
        };
        const result = await ApplicationsCollection.updateOne(filter, {
          $set: updateFields,
        });

      
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
          console.error(
            "Failed to auto-reject other applications after pay:",
            e
          );
        }

        return res.send(result);
      
    });
    app.delete("/applications/:id", verifyFBToken, async (req, res) => {
     
        const idParam = req.params.id;
        let filter;
        try {
          filter = { _id: new ObjectId(idParam) };
        } catch (err) {
          return res.status(400).send({ message: "Invalid application id" });
        }

        const appDoc = await ApplicationsCollection.findOne(filter);
        if (!appDoc)
          return res.status(404).send({ message: "Application not found" });

        const requesterEmail = String(req.decoded_email || "")
          .toLowerCase()
          .trim();
        const requester = await UsersCollection.findOne({
          email: requesterEmail,
        });
        const requesterRole = String(requester?.role || "")
          .toLowerCase()
          .trim();

        const isAdmin = requesterRole === "admin";
        const isStudentOwner =
          appDoc.studentEmail &&
          appDoc.studentEmail.toLowerCase().trim() === requesterEmail;
        const isTutorOwner =
          appDoc.tutorEmail &&
          appDoc.tutorEmail.toLowerCase().trim() === requesterEmail;

        if (!isAdmin && !isStudentOwner && !isTutorOwner) {
          return res.status(403).send({
            message: "Forbidden: only related users or admin can delete",
          });
        }

        const result = await ApplicationsCollection.deleteOne(filter);
        return res.send(result);
     
    });

    app.get("/tutors", async (req, res) => {git
      const result = await TutorCollection.find()
        .sort({ createdAt: -1 })
        .toArray();

      res.send(result);
    });

    app.get("/my-tutors", verifyFBToken, async (req, res) => {
      const { email } = req.query;

      const items = await TutorCollection.find({
        email: String(email).toLowerCase().trim(),
      })
        .sort({ createdAt: -1 })
        .toArray();
      return res.send(items);
    });

    app.patch("/tutors/:id", verifyFBToken, verifyTutor, async (req, res) => {
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

    app.delete("/tutors/:id", verifyFBToken, async (req, res) => {
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

    app.patch(
      "/tutors/:id/status",
      verifyFBToken,
      verifyADMIN,
      async (req, res) => {
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
      }
    );

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

    app.post("/tutors", verifyFBToken, verifyTutor, async (req, res) => {
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
    app.patch(
      "/users/:id/role",
      verifyFBToken,
      verifyADMIN,
      async (req, res) => {
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
      }
    );
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
      const requester = await UsersCollection.findOne({
        email: requesterEmail,
      });

      const { name, phone } = req.body;

      const updateFields = {};
      if (typeof name === "string") updateFields.name = name.trim();
      if (typeof phone === "string") updateFields.phone = phone.trim();

      updateFields.updatedAt = new Date();

      const filter = { _id: new ObjectId(id) };

      const result = await UsersCollection.updateOne(filter, {
        $set: updateFields,
      });

      res.send(result);
    });

    app.delete("/users/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const _id = new ObjectId(id);

      const result = await UsersCollection.deleteOne({ _id });

      res.send(result);
    });

    app.get("/my-tuitions", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const normalized = String(email).toLowerCase().trim();
      const result = await TuitionsCollection.find({
        createdBy: normalized,
      })
        .sort({ createdAt: -1 })
        .toArray();
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

    app.patch(
      "/tuitions/:id/status",
      verifyFBToken,
      verifyADMIN,
      async (req, res) => {
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
      }
    );

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

    app.post("/tuitions", verifyFBToken, async (req, res) => {
      const {
        name,
        subject,
        class: tuitionClass,
        location,
        budget,
        createdBy,
      } = req.body;

      const tuition = {
        name: name,
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
