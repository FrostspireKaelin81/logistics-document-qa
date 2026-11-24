import { strict as assert } from "node:assert";
import { decideEscalation } from "./logistics_question.js";

const review = decideEscalation("The proof shows a damaged parcel exception.", "SHP-1042");
assert.equal(review.status, "needs_review");
assert.equal(review.shipmentId, "SHP-1042");
const answered = decideEscalation("Delivery was accepted by Jordan Lee.", "SHP-1043");
assert.equal(answered.status, "answered");
console.log("shipment decision test passed");
