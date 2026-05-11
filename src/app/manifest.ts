import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#fbfaf5",
    description: "Capture-first personal knowledge base.",
    display: "standalone",
    name: "Sift",
    scope: "/",
    share_target: {
      action: "/capture",
      enctype: "application/x-www-form-urlencoded",
      method: "get",
      text: "text",
      title: "title",
      url: "url",
    },
    short_name: "Sift",
    start_url: "/capture",
    theme_color: "#2f6f5e",
  };
}
