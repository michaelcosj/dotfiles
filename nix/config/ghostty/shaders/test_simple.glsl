void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    // Just show the original content
    fragColor = texture(iChannel0, fragCoord.xy / iResolution.xy);
    
    // Add a simple red square in the top-left corner to verify shader is working
    if (fragCoord.x < 50.0 && fragCoord.y < 50.0) {
        fragColor = vec4(1.0, 0.0, 0.0, 1.0);
    }
}