const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion,ObjectId} = require('mongodb');
const jwt = require('jsonwebtoken');
const app = express();
const port = process.env.PORT || 3000;
dotenv.config();
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
// Middlewares
app.use(cors({
  // origin: 'http://localhost:5173',  
  origin:  [
    'http://localhost:5173',  // local dev
    // 'https://gleaming-alpaca-00df2d.netlify.app' // deployed site
  ], 
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
//   credentials: true
}))

app.use(express.json());  
///// connect t


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@mydatabase.9tcbic6.mongodb.net/?retryWrites=true&w=majority&appName=MyDataBase`;





const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// collections 

const usersCollection = client.db('smartBazarDB').collection('users');
const productCollection=client.db('smartBazarDB').collection('products')
const advertisementCollection = client.db("smartBazarDB").collection("advertisements");
const watchlistCollection= client.db('smartBazarDB').collection('watchlists')
const reviewsCollection=client.db('smartBazarDB').collection('reviews')
const paymentsCollection=client.db('smartBazarDB').collection('payments')


async function run() {
  try {
   
    await client.connect();



    // verifying 


    const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
 
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader?.split(' ')[1]; 

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Token missing' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Forbidden: Invalid token' });
    }
    req.user = decoded; 
    next();
  });
};
// verify user 

const verifyUser = (req, res, next) => {
  const emailFromToken = req.user.email;
  const emailFromReq = req.params?.userEmail || req.body?.userEmail || req.query?.email

  if (emailFromToken !== emailFromReq) {
    return res.status(403).json({ error: "Forbidden: You can only access your own data" });
  }
  next();
};
//  verify admin 
const verifyAdmin = async (req, res, next) => {
  try {
    const email = req.user.email;
    const user = await usersCollection.findOne({ email });

    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role !== "admin") return res.status(403).json({ error: "Forbidden: Requires admin role" });

    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};
//   verify vendor 

const verifyVendor = async (req, res, next) => {
  try {
    const email = req.user.email;
    const user = await usersCollection.findOne({ email });

    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role !== "vendor") return res.status(403).json({ error: "Forbidden: Requires vendor role" });

    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};
// jwt based login 

app.post('/jwt', async (req, res) => {
  const user = req.body; 
  const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.send({ token });
});


//  recommendations 

app.get("/recommendations", async (req, res) => {
  try {
    const budget = parseFloat(req.query.budget);
    if (!budget) return res.status(400).json({ error: "Budget is required" });

    
    const products = await productCollection.find({ status: "approved" }).toArray();

    const productsWithLatestPrice = products.map((prod) => {
      const latestPriceObj = prod.prices.reduce((a, b) =>
        new Date(a.date) > new Date(b.date) ? a : b
      );
      return {
        _id: prod._id,
        itemName: prod.itemName,
        marketName: prod.marketName,
        image: prod.image,
        price: Number(latestPriceObj.price), 
      };
    });

    productsWithLatestPrice.sort((a, b) => a.price - b.price);

    let total = 0;
    const affordableItems = [];
    for (let item of productsWithLatestPrice) {
      if (total + item.price <= budget) {
        affordableItems.push(item);
        total += item.price;
      }
    }

    res.json({ budget, total, items: affordableItems });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// approved producst 



app.get('/productsApproved', async (req, res) => {
  try {
    const { sort, startDate, endDate, page = 0, limit = 10 } = req.query;

    const skip = parseInt(page) * parseInt(limit);
    const limitNum = parseInt(limit);

    let filter = { status: 'approved' };

    if (startDate || endDate) {
      filter.prices = { $elemMatch: {} };
      if (startDate) filter.prices.$elemMatch.date = { $gte: startDate };
      if (endDate) {
        filter.prices.$elemMatch.date = filter.prices.$elemMatch.date || {};
        filter.prices.$elemMatch.date.$lte = endDate;
      }
    }

    let products = await productCollection.find(filter).skip(skip).limit(limitNum).toArray();

   
    products = products.map((product) => {
      const sortedPrices = Array.isArray(product.prices)
        ? [...product.prices].sort((a, b) => new Date(b.date) - new Date(a.date))
        : [];

      const latest = sortedPrices[0] || {};

      return {
        ...product,
        prices: sortedPrices,
        latestPrice: latest.price || 0,
        latestDate: latest.date || null,
        createdAt: product.createdAt || new Date(0),
      };
    });

   
    if (sort === 'priceAsc') {
      products.sort((a, b) => a.latestPrice - b.latestPrice);
    } else if (sort === 'priceDesc') {
      products.sort((a, b) => b.latestPrice - a.latestPrice);
    } else {
      products.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    const total = await productCollection.countDocuments(filter);

    res.json({ products, total });
  } catch (error) {
    console.error('GET /productsApproved error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});


app.get("/productsApproved/:id", async (req, res) => {
 
  

  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid product ID" });
  }

  try {
    const product = await productCollection.findOne({
      _id: new ObjectId(id),
      status: "approved", // only return if approved
    });

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json(product);
  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// details 


app.get('/market-details/:marketName', async (req, res) => {
  const marketName = req.params.marketName;
  try {
    const products = await productCollection
      .find({ marketName, status: "approved" })
      .sort({ "prices.date": -1 }) // Sort by recent price date
      .toArray();
    res.send({ products });
  } catch (error) {
    res.status(500).send({ error: 'Failed to fetch market details' });
  }
});


// product card 

app.get("/productsCard", async (req, res) => {
  try {
    const products = await productCollection
      .find({ status: "approved" })
      .toArray();

    const getLatestDate = (product) => {
      if (!Array.isArray(product.prices) || product.prices.length === 0) return new Date(0);

      const validDates = product.prices
        .map(p => new Date(p.date))
        .filter(date => !isNaN(date)); 

      if (validDates.length === 0) return new Date(0);

      return validDates.reduce((a, b) => (a > b ? a : b));
    };

    products.sort((a, b) => getLatestDate(b) - getLatestDate(a));

    res.json({ products });
  } catch (error) {
    console.error("GET /productsCard error:", error);
    res.status(500).json({ message: "Server error", details: error.message });
  }
});

// users api 

app.post('/users', async (req, res) => {
  const user = req.body;

  const existingUser = await usersCollection.findOne({ email: user.email });

  if (!existingUser) {
    const newUser = {
      name: user.name || 'Unknown',
      email: user.email,
      photoURL: user.photoURL || '', 
      role: 'user',                  
      contactNumber: user.contactNumber || 'N/A',
      address: user.address || 'N/A',
      bio: user.bio || 'N/A',
      createdAt: new Date(),         
    };

    const result = await usersCollection.insertOne(newUser);
    return res.send(result);
  }

  res.send({ message: 'User already exists' });
});

app.get('/users/:email', async (req, res) => {
  const email = req.params.email;
  const user = await usersCollection.findOne({ email });

  
  const completeUser = {
    name: user.name || 'Unknown',
    email: user.email,
    photoURL: user.photoURL || '',
    role: user.role || 'user',
    contactNumber: user.contactNumber || 'N/A',
    address: user.address || 'N/A',
    bio: user.bio || 'N/A',
    createdAt: user.createdAt || new Date(),
  };

  res.send(completeUser);
});
// PATCH /users/:email
app.patch('/users/:email', async (req, res) => {
  const email = req.params.email;
  const updatedData = req.body;

  try {
    const updateFields = {
      name: updatedData.name,
      photoURL: updatedData.photoURL,
      contactNumber: updatedData.contactNumber,
      address: updatedData.address,
      bio: updatedData.bio,
      updatedAt: new Date(),
    };

    const result = await usersCollection.updateOne(
      { email },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ message: "User not found" });
    }

    const updatedUser = await usersCollection.findOne({ email });
    res.send(updatedUser);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});



// products 


app.post("/products",verifyJWT,verifyVendor, async (req, res) => {
  const product = req.body;

  if (!product.vendorEmail || !product.itemName || !product.prices?.length) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const productWithTimestamp = {
      ...product,
      createdAt: new Date(),  // Add createdAt here
    };

    const result = await productCollection.insertOne(productWithTimestamp);
    res.status(201).json({ insertedId: result.insertedId });
  } catch (err) {
    console.error("❌ Failed to insert product:", err);
    res.status(500).json({ message: "Server error" });
  }
});


app.get("/products", verifyJWT,verifyAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page);
    const limit = 10;

    if (!isNaN(page)) {
      const skip = page * limit;
      const products = (await productCollection.find().skip(skip).limit(limit).sort({ createdAt: -1 }).toArray());
      const total = await productCollection.estimatedDocumentCount();

      return res.json({ products, total }); // Paginated response
    }

    // Fallback for existing frontend pages expecting full list
    const products = await productCollection.find().toArray();
    res.json(products); // Full list
  } catch (err) {
    console.error("Failed to fetch products:", err);
    res.status(500).json({ message: "Failed to fetch products" });
  }
});





// Add product to watchlist
app.post('/watchlist', async (req, res) => {
  const { userEmail, productId } = req.body;
  if (!userEmail || !productId) {
    return res.status(400).json({ error: 'userEmail and productId required' });
  }

  const existing = await watchlistCollection.findOne({ userEmail, productId });
  if (existing) return res.status(409).json({ message: 'Already in watchlist' });

  await watchlistCollection.insertOne({
    userEmail,
    productId,
    addedAt: new Date(),
  });
  res.json({ message: 'Added to watchlist' });
});


// GET watchlist by uapp
app.get("/watchlist/:userEmail", verifyJWT,verifyUser, async (req, res) => {
  const { userEmail } = req.params;
  if (!userEmail) {
    return res.status(400).json({ error: "userEmail required" });
  }

  try {
    // Find watchlist entries for user
    const watchlistItems = await watchlistCollection
      .find({ userEmail })
      .sort({ addedAt: -1 })
      .toArray();

    // Convert productIds to ObjectId array for lookup
    const productIds = watchlistItems
      .map((item) => {
        try {
          return new ObjectId(item.productId);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    // Fetch product details from products collection
    const products = await productCollection
      .find({ _id: { $in: productIds } })
      .project({ itemName: 1, marketName: 1 })
      .toArray();

    // Map productId (string) to product info
    const productMap = {};
    products.forEach((p) => {
      productMap[p._id.toString()] = p;
    });

    // Combine watchlist entries with product info
    const result = watchlistItems.map((item) => {
      const prod = productMap[item.productId];
      return {
        productId: item.productId,
        productName: prod?.itemName || "Unknown",
        marketName: prod?.marketName || "Unknown",
        addedAt: item.addedAt,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("Error fetching watchlist:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE watchlist item by userEmail & productId
app.delete("/watchlist",verifyJWT,verifyUser, async (req, res) => {
  const { userEmail, productId } = req.body;
  if (!userEmail || !productId) {
    return res.status(400).json({ error: "userEmail and productId required" });
  }

  try {
    const deleteResult = await watchlistCollection.deleteOne({
      userEmail,
      productId,
    });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ error: "Watchlist item not found" });
    }

    res.json({ message: "Removed from watchlist" });
  } catch (err) {
    console.error("Error removing watchlist item:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});



// reviews 

//  Submit Review
app.post("/reviews",verifyJWT, async (req, res) => {
  const { marketName, userEmail, userName, rating, comment, date } = req.body;

  if (!marketName || !userEmail || !rating) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const newReview = {
    marketName,
    userEmail,
    userName,
    rating,
    comment,
    createdAt: date ? new Date(date) : new Date(),
  };

  await reviewsCollection.insertOne(newReview);
  res.json({ message: "Review submitted" });
});

// GET: Reviews by Market
app.get("/reviews/:marketName", verifyJWT, async (req, res) => {
  const marketName = req.params.marketName;
  const reviews = await reviewsCollection
    .find({ marketName })
    .sort({ createdAt: -1 })
    .toArray();

  res.json(reviews);
});



// Get price trend data for a specific item from a specific market


app.get("/price-trend/:productId",verifyJWT, async (req, res) => {
  const { productId } = req.params;

  const product = await productCollection.findOne({ _id: new ObjectId(productId) });

  if (!product || !product.prices?.length) {
    return res.send([]);
  }

  const sortedPrices = product.prices.sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  res.send(sortedPrices);
});







// get products by vendor 

app.get('/products/vendor/:email',verifyJWT,verifyVendor, async (req, res) => {
  const email = req.params.email;
  const products = await productCollection.find({ vendorEmail: email }).sort({ createdAt: -1 }).toArray();
  res.send(products);
});

// by id 
app.get('/products/:id',verifyJWT, async (req, res) => {
  const id = req.params.id;
  try {
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }
    const product = await productCollection.findOne({ _id: new ObjectId(id) });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json(product);
  } catch (error) {
    console.error('Error fetching product by ID:', error);
    res.status(500).json({ message: "Server error" });
  }
});

// DELETE: Delete a product
app.delete('/products/:id',verifyJWT, async (req, res) => {
  const id = req.params.id;
  const result = await productCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});



// PATCH: Update product

app.patch('/products/:id', verifyJWT, async (req, res) => {
  const id = req.params.id;
  const updatedData = req.body;

  try {
    const result = await productCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );
    
    res.send(result);
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).send({ error: "Failed to update product" });
  }
});




// advertisemnets 
app.post('/advertisements',verifyJWT,verifyVendor, async (req, res) => {
  try {
    const ad = req.body;

    // Set default status if not present
    ad.status = ad.status || "pending";

    // Optional: add createdAt
    ad.createdAt = new Date();

    const result = await advertisementCollection.insertOne(ad);
    res.status(201).json({ insertedId: result.insertedId });
  } catch (error) {
    console.error("Failed to insert ad:", error);
    res.status(500).json({ message: "Server error" });
  }
});

 // Get all ads by vendor email
  app.get("/advertisements",verifyJWT,verifyVendor, async (req, res) => {
  try {
    const vendorEmail = req.query.vendorEmail;  // read from query string
    if (!vendorEmail) {
      return res.status(400).json({ error: "vendorEmail query parameter is required" });
    }
    const ads = await advertisementCollection.find({ vendorEmail }). sort({ createdAt: -1 }).toArray();
    res.json(ads);
  } catch (error) {
    console.error("GET /advertisements error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
//   all ads home page
  app.get('/advertisements/home', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 5;
  const skip = (page - 1) * limit;

  const ads = await advertisementCollection
    .find({ status: "approved" })
    .sort({ createdAt: -1 }) // Latest first
    .skip(skip)
    .limit(limit)
    .toArray();

  const total = await advertisementCollection.countDocuments({ status: "approved" });

  res.send({
    ads,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
  });
});
app.get("/advertisements/all", verifyJWT,verifyAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const limit = 10;
    const skip = page * limit;

    const total = await advertisementCollection.estimatedDocumentCount();

    const ads = await advertisementCollection
      .find()
      .sort({ createdAt: -1 }) 
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({ ads, total });
  } catch (error) {
    console.error("GET /advertisements/all error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


  // Update an ad by ID
  app.put("/advertisements/:id",verifyJWT, async (req, res) => {
    try {
      const id = req.params.id;
      const updateData = req.body;

      // Remove _id to avoid MongoDB error
      delete updateData._id;

      const result = await advertisementCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ error: "Advertisement not found" });
      }

      res.json({ message: "Advertisement updated successfully" });
    } catch (error) {
      console.error("PUT /advertisements/:id error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
 // Delete an ad by ID
  app.delete("/advertisements/:id",verifyJWT, async (req, res) => {
    try {
      const id = req.params.id;
      const result = await advertisementCollection.deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return res.status(404).json({ error: "Advertisement not found" });
      }

      res.json({ message: "Advertisement deleted successfully" });
    } catch (error) {
      console.error("DELETE /advertisements/:id error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });


//   admin apis 


// all user 



app.get("/users",verifyJWT,verifyAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 0;
    const limit = 10;
    const skip = page * limit;
    const search = req.query.search || "";

    const searchQuery = {
      $or: [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ],
    };

    const cursor = usersCollection.find(search ? searchQuery : {})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const users = await cursor.toArray();
    const total = await usersCollection.countDocuments(search ? searchQuery : {});

    res.json({ users, total });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


app.patch("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  try {
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role } }
    );
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    console.error("Error updating user role:", err);
    res.status(500).json({ error: "Failed to update user role." });
  }
});


// payments 

app.post("/create-payment-intent",verifyJWT, async (req, res) => {
  const { amount } = req.body;

  // Stripe needs smallest currency unit → AED fils = * 100
  let convertedAmount = Math.round(amount * 100); // treating BDT as AED

  // Ensure minimum 200 fils (2 AED)
  if (convertedAmount < 200) {
    return res.status(400).send({
      error: "Minimum amount must be at least ৳2.00 (2 AED equivalent)",
    });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: convertedAmount,
      currency: "aed", // BDT as AED for testing
      payment_method_types: ["card"],
    });

    res.send({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("Error creating payment intent:", error.message);
    res.status(500).send({ error: error.message });
  }
});

// ✅ Save Payment Info
app.post("/payments",verifyJWT, async (req, res) => {
  const paymentData = req.body;

  try {
    const result = await paymentsCollection.insertOne(paymentData);
    res.send({ insertedId: result.insertedId });
  } catch (error) {
    console.error("Error saving payment:", error.message);
    res.status(500).send({ error: error.message });
  }
});

app.get("/payments", verifyJWT, async (req, res) => {
  try {
    const payments = await paymentsCollection.find().toArray();
    res.send(payments);
  } catch (error) {
    console.error("Error fetching payments:", error.message);
    res.status(500).send({ error: error.message });
  }
});
// my orders 

app.get('/payments/my-orders',verifyJWT,verifyUser, async (req, res) => {
  try {
    const userEmail = req.query.email;
    if (!userEmail) {
      return res.status(400).json({ error: 'User email is required' });
    }

    const orders = await paymentsCollection
      .find({ userEmail })
      .sort({ date: -1 })
      .toArray();

    res.json(orders);
  } catch (error) {
    console.error('Error fetching user orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// Get payments for a specific user
app.get("/payments/user/:email", async (req, res) => {
  const email = req.params.email;
  try {
    const payments = await paymentsCollection.find({ userEmail: email }).toArray();
    res.send(payments);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch payments" });
  }
});
// Get all payments received by a vendor
app.get("/payments/vendor/:email", verifyJWT, async (req, res) => {
  const vendorEmail = req.params.email;

  try {
    const payments = await paymentsCollection
      .find({ vendorEmail }) // filter payments for this vendor
      .sort({ createdAt: -1 }) // optional: sort by most recent
      .toArray();

    res.send(payments);
  } catch (error) {
    console.error("Error fetching vendor payments:", error.message);
    res.status(500).send({ error: error.message });
  }
});

// all orders ?\
app.get("/all-orders",verifyJWT,verifyAdmin, async (req, res) => {
    try {
      const orders = await paymentsCollection
        .find({})
        .sort({ date: -1 })
        .toArray();

      res.send(orders);
    } catch (err) {
      console.error("Error fetching all orders:", err);
      res.status(500).json({ message: "Server error" });
    }
  });
    // // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);





app.get('/', (req, res) => {
  res.send(' Bazar Server is running!');
});


app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
