export const marketLabelKeys: Record<string, string> = {
  "Ending soon": "labelEnd",
  "Price: low to high": "labelAsc",
  "Price: high to low": "labelDesc",
  "Most popular": "labelPopular",
  All: "labelAll",
  Active: "labelMine",
  Won: "labelWon",
  Sold: "labelSales",
  Unsold: "labelUnsold",
  Auctions: "labelBrowse",
  "My auctions": "labelMyAuctions"
};

export const marketEmptyStates = {
  all: {
    title: "emptyallTitle",
    text: "emptyallText",
    action: "emptyallAction"
  },
  mine: {
    title: "emptymineTitle",
    text: "emptymineText",
    action: "emptymineAction"
  },
  won: {
    title: "emptywonTitle",
    text: "emptywonText",
    action: "emptywonAction"
  },
  sales: {
    title: "emptysalesTitle",
    text: "emptysalesText",
    action: "emptysalesAction"
  },
  unsold: {
    title: "emptyunsoldTitle",
    text: "emptyunsoldText",
    action: "emptyunsoldAction"
  }
} as const;
